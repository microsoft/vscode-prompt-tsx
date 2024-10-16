/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IncomingMessage, OutgoingMessage, Server } from 'http';
import type { AddressInfo } from 'net';
import { tracerCss, tracerSrc } from './htmlTracerSrc';
import {
	HTMLTraceEpoch,
	IHTMLTraceRenderData,
	IMaterializedMetadata,
	ITraceMaterializedContainer,
	ITraceMaterializedNode,
	TraceMaterializedNodeType,
} from './htmlTracerTypes';
import {
	MaterializedChatMessage,
	MaterializedChatMessageTextChunk,
	MaterializedContainer,
	MaterializedNode,
} from './materialized';
import { PromptMetadata } from './results';
import { ITokenizer } from './tokenizer/tokenizer';
import { ITraceData, ITraceEpoch, ITracer, ITraceRenderData } from './tracer';

/**
 * Handler that can trace rendering internals into an HTML summary.
 */
export class HTMLTracer implements ITracer {
	private traceData?: ITraceData;
	private readonly epochs: ITraceEpoch[] = [];

	addRenderEpoch(epoch: ITraceEpoch): void {
		this.epochs.push(epoch);
	}

	didMaterializeTree(traceData: ITraceData): void {
		this.traceData = traceData;
	}

	/**
	 * Returns HTML to trace the output. Note that is starts a server which is
	 * used for client interaction to resize the prompt and its `address` should
	 * be displayed or opened as a link in a browser.
	 *
	 * The server runs until it is disposed.
	 */
	public async serveHTML(): Promise<IHTMLServer> {
		return RequestServer.create({
			epochs: this.epochs,
			traceData: mustGet(this.traceData),
		});
	}

	/**
	 * Gets an HTML router for a server at the URL. URL is the form `http://127.0.0.1:1234`.
	 */
	public serveRouter(url: string): IHTMLRouter {
		return new RequestRouter({
			baseAddress: url,
			epochs: this.epochs,
			traceData: mustGet(this.traceData),
		});
	}
}

export interface IHTMLRouter {
	address: string;
	route(httpIncomingMessage: unknown, httpOutgoingMessage: unknown): boolean;
}

export interface IHTMLServer {
	address: string;
	getHTML(): Promise<string>;
	dispose(): void;
}

interface IServerOpts {
	epochs: ITraceEpoch[];
	traceData: ITraceData;
	baseAddress: string;
}

class RequestRouter implements IHTMLRouter {
	private serverToken = crypto.randomUUID();

	constructor(private readonly opts: IServerOpts) { }

	public route(httpIncomingMessage: unknown, httpOutgoingMessage: unknown): boolean {
		const req = httpIncomingMessage as IncomingMessage;
		const res = httpOutgoingMessage as OutgoingMessage;
		const url = new URL(req.url || '/', `http://localhost`);
		const prefix = `/${this.serverToken}`;
		switch (url.pathname) {
			case prefix:
			case `${prefix}/`:
				this.onRoot(url, req, res);
				break;
			case `${prefix}/regen`:
				this.onRegen(url, req, res);
				break;
			default:
				return false;
		}

		return true;
	}

	public get address() {
		return this.opts.baseAddress + '/' + this.serverToken;
	}

	public async getHTML() {
		const { traceData, epochs } = this.opts;
		return `<body>
			<style>${tracerCss}</style>
			<script>
				const DEFAULT_TOKENS = ${JSON.stringify(traceData.budget)};
				const EPOCHS = ${JSON.stringify(epochs satisfies HTMLTraceEpoch[])};
				const DEFAULT_MODEL = ${JSON.stringify(
			await serializeRenderData(traceData.tokenizer, traceData.renderedTree)
		)};
				const SERVER_ADDRESS = ${JSON.stringify(this.opts.baseAddress + '/' + this.serverToken + '/')};
				${tracerSrc}
			</script>
		</body>`;
	}

	private async onRegen(url: URL, _req: IncomingMessage, res: OutgoingMessage) {
		const { traceData } = this.opts;
		const budget = Number(url.searchParams.get('n') || traceData.budget);
		const renderedTree = await traceData.renderTree(budget);
		const serialized = await serializeRenderData(traceData.tokenizer, renderedTree);
		const json = JSON.stringify(serialized);
		res.setHeader('Content-Type', 'application/json');
		res.setHeader('Content-Length', Buffer.byteLength(json));
		res.end(json);
	}

	private onRoot(_url: URL, _req: IncomingMessage, res: OutgoingMessage) {
		this.getHTML().then(html => {
			res.setHeader('Content-Type', 'text/html');
			res.setHeader('Content-Length', Buffer.byteLength(html));
			res.end(html);
		});
	}
}

class RequestServer extends RequestRouter implements IHTMLServer {
	public static async create(opts: Omit<IServerOpts, 'baseAddress'>) {
		const { createServer } = await import('http');
		const server = createServer((req, res) => {
			try {
				if (!instance.route(req, res)) {
					res.statusCode = 404;
					res.end('Not Found');
				}
			} catch (e) {
				res.statusCode = 500;
				res.end(String(e));
			}
		});

		const port = await new Promise<number>((resolve, reject) => {
			server
				.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
				.on('error', reject);
		});

		const instance = new RequestServer(
			{
				...opts,
				baseAddress: `http://127.0.0.1:${port}`,
			},
			server
		);

		return instance;
	}

	constructor(opts: IServerOpts, private readonly server: Server) {
		super(opts);
	}

	dispose() {
		this.server.closeAllConnections();
		this.server.close();
	}
}

async function serializeRenderData(
	tokenizer: ITokenizer,
	tree: ITraceRenderData
): Promise<IHTMLTraceRenderData> {
	return {
		container: (await serializeMaterialized(
			tokenizer,
			tree.container,
			false
		)) as ITraceMaterializedContainer,
		removed: tree.removed,
		budget: tree.budget,
	};
}

async function serializeMaterialized(
	tokenizer: ITokenizer,
	materialized: MaterializedNode,
	inChatMessage: boolean
): Promise<ITraceMaterializedNode> {
	const common = {
		metadata: materialized.metadata.map(serializeMetadata),
		priority: materialized.priority,
	};

	if (materialized instanceof MaterializedChatMessageTextChunk) {
		return {
			...common,
			type: TraceMaterializedNodeType.TextChunk,
			value: materialized.text,
			tokens: await materialized.upperBoundTokenCount(tokenizer),
		};
	} else {
		const containerCommon = {
			...common,
			id: materialized.id,
			name: materialized.name,
			children: await Promise.all(
				materialized.children.map(c =>
					serializeMaterialized(
						tokenizer,
						c,
						inChatMessage || materialized instanceof MaterializedChatMessage
					)
				)
			),
			tokens: inChatMessage
				? await materialized.upperBoundTokenCount(tokenizer)
				: await materialized.tokenCount(tokenizer),
		};

		if (materialized instanceof MaterializedContainer) {
			return {
				...containerCommon,
				type: TraceMaterializedNodeType.Container,
			};
		} else if (materialized instanceof MaterializedChatMessage) {
			return {
				...containerCommon,
				type: TraceMaterializedNodeType.ChatMessage,
				role: materialized.role,
				text: materialized.text,
			};
		}
	}

	assertNever(materialized);
}

function assertNever(x: never): never {
	throw new Error('unreachable');
}

function serializeMetadata(metadata: PromptMetadata): IMaterializedMetadata {
	return { name: metadata.constructor.name, value: JSON.stringify(metadata) };
}

const mustGet = <T>(value: T | undefined): T => {
	if (value === undefined) {
		throw new Error('Prompt must be rendered before calling HTMLTRacer.serveHTML');
	}

	return value;
};
