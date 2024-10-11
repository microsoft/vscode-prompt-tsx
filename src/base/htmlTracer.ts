/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IncomingMessage, OutgoingMessage, Server } from 'http';
import type { AddressInfo } from 'net';
import { tracerCss, tracerSrc } from './htmlTracerSrc';
import { HTMLTraceEpoch, IHTMLTraceRenderData, IMaterializedMetadata, ITraceMaterializedContainer, ITraceMaterializedNode, TraceMaterializedNodeType } from './htmlTracerTypes';
import { MaterializedChatMessage, MaterializedChatMessageTextChunk, MaterializedContainer, MaterializedNode } from './materialized';
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
	 * used for client interaction to resize the prompt and its value should
	 * be disp
	 */
	public async serveHTML(): Promise<IHTMLServer> {
		const serverToken = crypto.randomUUID();
		const traceData = mustGet(this.traceData);
		const html = `<body>
			<style>${tracerCss}</style>
			<script>
				const DEFAULT_TOKENS = ${JSON.stringify(traceData.budget)};
				const EPOCHS = ${JSON.stringify(this.epochs satisfies HTMLTraceEpoch[])};
				const DEFAULT_MODEL = ${JSON.stringify(await serializeRenderData(traceData.tokenizer, traceData.renderedTree))};
				${tracerSrc}
			</script>
		</body>`;

		return RequestServer.create({
			html,
			serverToken,
			traceData,
		})
	}
}

export interface IHTMLServer {
	address: string;
	html: string;
	dispose(): void;
}

interface IServerOpts {
	html: string;
	serverToken: string;
	traceData: ITraceData;
}

class RequestServer implements IHTMLServer {
	public static async create(opts: IServerOpts) {
		const { createServer } = await import('http');
		const prefix = `/${opts.serverToken}`;

		const server = createServer((req, res) => {
			const url = new URL(req.url || '/', `http://localhost`);
			try {
				switch (url.pathname) {
					case ``:
					case `${prefix}/`: return instance.onRoot(url, req, res);
					case `${prefix}/regen`: return instance.onRegen(url, req, res);
					default:
						res.statusCode = 404;
						res.end('Not Found');
				}
			} catch (e) {
				res.statusCode = 500;
				res.end(String(e));
			}
		});
		const instance = new RequestServer(opts, server);

		instance.port = await new Promise<number>((resolve, reject) => {
			server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)).on('error', reject);
		});

		return instance;
	}

	private port!: number;

	public get address() {
		return `http://127.0.0.1:${this.port}/${this.opts.serverToken}/`;
	}

	public get html() {
		return this.opts.html;
	}

	constructor(
		private readonly opts: IServerOpts,
		private readonly server: Server
	) {
	}

	dispose() {
		this.server.closeAllConnections();
		this.server.close();
	}

	private async onRegen(url: URL, _req: IncomingMessage, res: OutgoingMessage) {
		const { traceData } = this.opts;
		const budget = Number(url.searchParams.get('n') || traceData.budget);
		const renderedTree = await traceData.renderTree(budget);
		const serialized = await serializeRenderData(traceData.tokenizer, renderedTree)
		const json = JSON.stringify(serialized);
		res.setHeader('Content-Type', 'application/json');
		res.setHeader('Content-Length', Buffer.byteLength(json));
		res.end(json);

	}

	private onRoot(_url: URL, _req: IncomingMessage, res: OutgoingMessage) {
		const html = `<script>globalThis.SERVER_ADDRESS=${JSON.stringify(this.address)}</script>` + this.opts.html;
		res.setHeader('Content-Type', 'text/html');
		res.setHeader('Content-Length', html.length);
		res.end(html);
	}
}

async function serializeRenderData(tokenizer: ITokenizer, tree: ITraceRenderData): Promise<IHTMLTraceRenderData> {
	return {
		container: await serializeMaterialized(tokenizer, tree.container) as ITraceMaterializedContainer,
		removed: tree.removed,
		budget: tree.budget,
	};
}

async function serializeMaterialized(tokenizer: ITokenizer, materialized: MaterializedNode): Promise<ITraceMaterializedNode> {
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
		}
	} else {
		const containerCommon = {
			...common,
			id: materialized.id,
			name: materialized.name,
			children: await Promise.all(materialized.children.map(c => serializeMaterialized(tokenizer, c))),
			tokens: await materialized.tokenCount(tokenizer),
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
}
