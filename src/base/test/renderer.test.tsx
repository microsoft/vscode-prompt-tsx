/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import type * as vscode from 'vscode';
import { OutputMode, Raw, renderElementJSON } from '..';
import { BaseTokensPerCompletion, ChatMessage, ChatRole } from '../output/openaiTypes';
import { PromptElement } from '../promptElement';
import {
	AssistantMessage,
	BaseImageMessage,
	Chunk,
	Expandable,
	IfEmpty,
	LegacyPrioritization,
	PrioritizedList,
	SystemMessage,
	TextChunk,
	TokenLimit,
	ToolMessage,
	ToolResult,
	useKeepWith,
	UserMessage,
} from '../promptElements';
import { PromptRenderer, RenderPromptResult } from '../promptRenderer';
import { PromptMetadata, PromptReference } from '../results';
import { Cl100KBaseTokenizer } from '../tokenizer/cl100kBaseTokenizer';
import { ITokenizer } from '../tokenizer/tokenizer';
import {
	BasePromptElementProps,
	IChatEndpointInfo,
	PromptElementCtor,
	PromptPiece,
	PromptPieceChild,
	PromptSizing,
} from '../types';
import { strFrom } from './testUtils';

class LanguageModelTextPart implements vscode.LanguageModelTextPart {
	constructor(public value: string) {}
}

class LanguageModelPromptTsxPart implements vscode.LanguageModelPromptTsxPart {
	constructor(public value: unknown) {}
}

class LanguageModelToolResult implements vscode.LanguageModelToolResult {
	constructor(public content: Array<LanguageModelTextPart | LanguageModelPromptTsxPart>) {}
}

suite('PromptRenderer', () => {
	const fakeEndpoint: any = {
		modelMaxPromptTokens: 8192 - BaseTokensPerCompletion,
	} satisfies Partial<IChatEndpointInfo>;
	const tokenizer = new Cl100KBaseTokenizer();

	async function renderWithMaxPromptTokens<
		P extends BasePromptElementProps = BasePromptElementProps
	>(
		maxPromptTokens: number,
		ctor: PromptElementCtor<P, any>,
		props: P
	): Promise<RenderPromptResult> {
		const fakeEndpoint: any = {
			modelMaxPromptTokens: maxPromptTokens,
		} satisfies Partial<IChatEndpointInfo>;
		const inst = new PromptRenderer(fakeEndpoint, ctor, props, tokenizer);
		return await inst.render(undefined, undefined);
	}

	async function renderFragmentWithMaxPromptTokens(
		maxPromptTokens: number,
		piece: PromptPieceChild
	): Promise<RenderPromptResult> {
		const fakeEndpoint: any = {
			modelMaxPromptTokens: maxPromptTokens,
		} satisfies Partial<IChatEndpointInfo>;
		const inst = new PromptRenderer(
			fakeEndpoint,
			class extends PromptElement {
				render() {
					return <>{piece}</>;
				}
			},
			{},
			tokenizer
		);
		return await inst.render(undefined, undefined);
	}

	test('token counting', async () => {
		class Prompt1 extends PromptElement {
			render() {
				return (
					<>
						<SystemMessage>
							You are a helpful, pattern-following assistant that translates corporate jargon into
							plain English.
						</SystemMessage>
						<SystemMessage name="example_user">
							New synergies will help drive top-line growth.
						</SystemMessage>
						<SystemMessage name="example_assistant">
							Things working well together will increase revenue.
						</SystemMessage>
						<SystemMessage name="example_user">
							Let's circle back when we have more bandwidth to touch base on opportunities for
							increased leverage.
						</SystemMessage>
						<SystemMessage name="example_assistant">
							Let's talk later when we're less busy about how to do better.
						</SystemMessage>
						<UserMessage>
							This late pivot means we don't have time to boil the ocean for the client deliverable.
						</UserMessage>
					</>
				);
			}
		}

		const inst = new PromptRenderer(fakeEndpoint, Prompt1, {}, tokenizer);
		const res = await inst.render(undefined, undefined);
		assert.deepStrictEqual(res.messages, [
			{
				role: Raw.ChatRole.System,
				content: [
					{
						type: Raw.ChatCompletionContentPartKind.Text,
						text: 'You are a helpful, pattern-following assistant that translates corporate jargon into plain English.',
					},
				],
			},
			{
				role: Raw.ChatRole.System,
				name: 'example_user',
				content: [
					{
						type: Raw.ChatCompletionContentPartKind.Text,
						text: 'New synergies will help drive top-line growth.',
					},
				],
			},
			{
				role: Raw.ChatRole.System,
				name: 'example_assistant',
				content: [
					{
						type: Raw.ChatCompletionContentPartKind.Text,
						text: 'Things working well together will increase revenue.',
					},
				],
			},
			{
				role: Raw.ChatRole.System,
				name: 'example_user',
				content: [
					{
						type: Raw.ChatCompletionContentPartKind.Text,
						text: "Let's circle back when we have more bandwidth to touch base on opportunities for increased leverage.",
					},
				],
			},
			{
				role: Raw.ChatRole.System,
				name: 'example_assistant',
				content: [
					{
						type: Raw.ChatCompletionContentPartKind.Text,
						text: "Let's talk later when we're less busy about how to do better.",
					},
				],
			},
			{
				role: Raw.ChatRole.User,
				content: [
					{
						type: Raw.ChatCompletionContentPartKind.Text,
						text: "This late pivot means we don't have time to boil the ocean for the client deliverable.",
					},
				],
			},
		]);
		assert.deepStrictEqual(res.tokenCount, 129 - BaseTokensPerCompletion);
	});

	test('runs async prepare in parallel', async () => {
		class Prompt3 extends PromptElement<
			{ timeout: number; index: number } & BasePromptElementProps
		> {
			override async prepare() {
				await new Promise(resolve => setTimeout(resolve, this.props.timeout));
			}
			render() {
				return <UserMessage>Hello {this.props.index}!</UserMessage>;
			}
		}

		const promptElements = [
			<Prompt3 timeout={200} index={1} />,
			<Prompt3 timeout={100} index={2} />,
			<Prompt3 timeout={300} index={3} />,
		];

		class Prompt2 extends PromptElement {
			render() {
				return <>{promptElements}</>;
			}
		}

		// First measure the time to render all elements sequentially
		let sequentialElapsedTime = 0;
		for (const promptElement of promptElements) {
			const inst1 = new PromptRenderer(fakeEndpoint, Prompt3, promptElement.props, tokenizer);
			const start = Date.now();
			await inst1.render(undefined, undefined);
			sequentialElapsedTime += Date.now() - start;
		}

		// Then measure the time to render all elements in parallel
		const inst2 = new PromptRenderer(fakeEndpoint, Prompt2, {}, tokenizer);

		const start = Date.now();
		const res = await inst2.render(undefined, undefined);
		const parallelElapsedTime = Date.now() - start;
		assert.ok(
			parallelElapsedTime < sequentialElapsedTime,
			`Prompt element parallel prepare took ${parallelElapsedTime}ms and sequential prepare took ${sequentialElapsedTime}ms`
		);

		// Make sure parallel preparation did not change the order of the produced messages
		assert.deepStrictEqual(res.messages, [
			{
				role: Raw.ChatRole.User,
				content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Hello 1!' }],
			},
			{
				role: Raw.ChatRole.User,
				content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Hello 2!' }],
			},
			{
				role: Raw.ChatRole.User,
				content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Hello 3!' }],
			},
		]);
	});

	test('maintains element order', async () => {
		class Prompt2 extends PromptElement<{ content: string } & BasePromptElementProps> {
			render() {
				return <TextChunk>{this.props.content}</TextChunk>;
			}
		}

		class Prompt1 extends PromptElement {
			render() {
				return (
					<>
						<SystemMessage>
							a
							<Prompt2 content="b" />c<TextChunk>d</TextChunk>e<TextChunk flexGrow={2}>f</TextChunk>
							g
							<Prompt2 content="h" flexGrow={1} />i
						</SystemMessage>
					</>
				);
			}
		}

		const inst = new PromptRenderer(fakeEndpoint, Prompt1, {}, tokenizer);
		const res = await inst.render(undefined, undefined);
		assert.deepStrictEqual(res.messages.length, 1);
		assert.deepStrictEqual(strFrom(res.messages[0]).replace(/\n/g, ''), 'abcdefghi');
	});

	test('renders tool calls', async () => {
		class Prompt1 extends PromptElement {
			render() {
				return (
					<>
						<AssistantMessage
							toolCalls={[
								{
									id: 'call_123',
									type: 'function',
									function: { name: 'tool1', arguments: '"{a: 1, b: [2]}"' },
								},
							]}
						>
							assistant
						</AssistantMessage>
						<ToolMessage toolCallId="call_123">tool result</ToolMessage>
					</>
				);
			}
		}

		const inst = new PromptRenderer(fakeEndpoint, Prompt1, {}, tokenizer);
		const res = await inst.render(undefined, undefined);
		assert.deepStrictEqual(res.messages, [
			{
				role: Raw.ChatRole.Assistant,
				toolCalls: [
					{
						id: 'call_123',
						type: 'function',
						function: {
							name: 'tool1',
							arguments: '"{a: 1, b: [2]}"',
						},
					},
				],
				content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'assistant' }],
			},
			{
				role: Raw.ChatRole.Tool,
				toolCallId: 'call_123',
				content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'tool result' }],
			},
		]);
	});

	async function* pruneDown(elements: PromptPiece) {
		const initialRender = await new PromptRenderer(
			{ modelMaxPromptTokens: Number.MAX_SAFE_INTEGER } as any,
			class extends PromptElement {
				render() {
					return elements;
				}
			},
			{},
			tokenizer
		).render();

		let tokens = initialRender.tokenCount;
		let last = '';
		while (tokens >= 0) {
			const res = await new PromptRenderer(
				{ modelMaxPromptTokens: tokens } as any,
				class extends PromptElement {
					render() {
						return elements;
					}
				},
				{},
				tokenizer
			).render();

			const messages = res.messages
				.map(m => `${Raw.ChatRole.display(m.role)}: ${strFrom(m)}`)
				.join('\n');
			if (messages === last) {
				tokens--;
				continue;
			}

			yield res.messages;
			if (!messages.length) {
				break;
			}

			last = messages;
			tokens--;
		}
	}

	suite('KeepWith', () => {
		test('works as expected', async () => {
			const KeepWith = useKeepWith();
			const it = pruneDown(
				<>
					<UserMessage>
						<KeepWith priority={1}>
							<TextChunk priority={1}>a</TextChunk>
							<TextChunk priority={2}>b</TextChunk>
						</KeepWith>
						<KeepWith priority={2}>
							<TextChunk>c</TextChunk>
						</KeepWith>
						<KeepWith priority={3}>
							<TextChunk>d</TextChunk>
						</KeepWith>
					</UserMessage>
				</>
			);

			let messages: string[] = [];
			for await (const m of it) {
				messages.push(m.map(strFrom).join(''));
			}

			assert.deepStrictEqual(messages, ['a\nb\nc\nd', 'b\nc\nd', '']);
		});

		test('cascades', async () => {
			const KeepWith1 = useKeepWith();
			const KeepWith2 = useKeepWith();
			const KeepWith3 = useKeepWith();
			const it = pruneDown(
				<>
					<UserMessage>
						<KeepWith1 priority={1}>
							<TextChunk priority={1}>a</TextChunk>
							<TextChunk priority={2}>b</TextChunk>
						</KeepWith1>
						<KeepWith1 priority={2}>
							<KeepWith2>
								<TextChunk>c#</TextChunk>
							</KeepWith2>
							<TextChunk>c</TextChunk>
						</KeepWith1>
						<KeepWith1 priority={3}>
							<TextChunk>d</TextChunk>
						</KeepWith1>
						<KeepWith2 priority={4}>
							<TextChunk>e</TextChunk>
						</KeepWith2>
						<KeepWith3 priority={5}>f</KeepWith3>
					</UserMessage>
				</>
			);

			let messages: string[] = [];
			for await (const m of it) {
				messages.push(m.map(strFrom).join(''));
			}

			assert.deepStrictEqual(messages, ['a\nb\nc#\nc\nd\ne\nf', 'b\nc#\nc\nd\ne\nf', 'f', '']);
		});

		test('trims tool calls', async () => {
			const KeepWith1 = useKeepWith();
			const KeepWith2 = useKeepWith();
			const KeepWith3 = useKeepWith();
			const it = pruneDown(
				<>
					<AssistantMessage
						toolCalls={[
							{
								id: '1',
								type: 'function',
								function: { name: 'tool1', arguments: '"a"' },
								keepWith: KeepWith1,
							},
							{
								id: '2',
								type: 'function',
								function: { name: 'tool2', arguments: '"b"' },
								keepWith: KeepWith2,
							},
						]}
					/>
					<AssistantMessage
						toolCalls={[
							{
								id: '3',
								type: 'function',
								function: { name: 'tool3', arguments: '"c"' },
								keepWith: KeepWith3,
							},
						]}
					/>
					<UserMessage>
						<KeepWith1 priority={1}>
							<TextChunk priority={1}>a</TextChunk>
						</KeepWith1>
						<KeepWith2 priority={2}>
							<TextChunk priority={2}>b</TextChunk>
						</KeepWith2>
						<KeepWith3 priority={3}>
							<TextChunk priority={3}>c</TextChunk>
						</KeepWith3>
					</UserMessage>
				</>
			);

			let messages: { content: string[]; tcIds: string[] }[] = [];
			for await (const m of it) {
				messages.push({
					content: m.map(m => `${Raw.ChatRole.display(m.role)}: ${strFrom(m)}`),
					tcIds: m
						.filter(m => m.role === Raw.ChatRole.Assistant)
						.flatMap(m => m.toolCalls ?? [])
						.map(tc => tc.id),
				});
			}

			assert.deepStrictEqual(messages, [
				{ content: ['assistant: ', 'assistant: ', 'user: a\nb\nc'], tcIds: ['1', '2', '3'] },
				{ content: ['assistant: ', 'assistant: ', 'user: b\nc'], tcIds: ['2', '3'] },
				{ content: ['assistant: ', 'user: c'], tcIds: ['3'] },
				{ content: [], tcIds: [] },
			]);
		});
	});

	suite('prunes in priority order', () => {
		async function assertPruningOrder(elements: PromptPiece, order: string[]) {
			let i = 0;
			let last = 'NONE';
			for await (const messages of pruneDown(elements)) {
				for (let k = 0; k < i; k++) {
					if (messages.some(m => strFrom(m).includes(order[k]))) {
						const text = messages.map(strFrom).join('');
						throw new Error(
							`Expected messages TO NOT HAVE "${order[k]}". Got:\n\n${text}\n\nLast was: ${last}`
						);
					}
				}
				for (let k = i; k < order.length; k++) {
					if (!messages.some(m => strFrom(m).includes(order[k]))) {
						const text = messages.map(strFrom).join('');
						throw new Error(
							`Expected messages TO INCLUDE "${order[k]}". Got:\n\n${text}\n\nLast was: ${last}`
						);
					}
				}

				i++;
				last = messages.map(strFrom).join('');
				if (i === order.length) {
					break;
				}
			}
		}

		test('basic siblings', async () => {
			await assertPruningOrder(
				<>
					<UserMessage>
						<TextChunk priority={1}>a</TextChunk>
						<TextChunk priority={2}>b</TextChunk>
						<TextChunk priority={3}>c</TextChunk>
					</UserMessage>
				</>,
				['a', 'b', 'c']
			);
		});

		test('chunks together', async () => {
			await assertPruningOrder(
				<>
					<UserMessage>
						<Chunk priority={1}>
							<TextChunk priority={1}>a</TextChunk>
							<TextChunk priority={2}>b</TextChunk>
						</Chunk>
						<TextChunk priority={3}>c</TextChunk>
					</UserMessage>
				</>,
				['a', 'c']
			); // 'b' should not get individually removed and cause a change
		});

		test('does not scope priorities in fragments', async () => {
			await assertPruningOrder(
				<>
					<UserMessage>
						<TextChunk priority={1}>b</TextChunk>
						<>
							<TextChunk priority={0}>a</TextChunk>
							<TextChunk priority={2}>c</TextChunk>
						</>
						<TextChunk priority={3}>d</TextChunk>
					</UserMessage>
				</>,
				['a', 'b', 'c', 'd']
			);
		});

		test('scopes priorities normally', async () => {
			class Wrap1 extends PromptElement {
				render() {
					return (
						<>
							<TextChunk priority={1}>a</TextChunk>
							<TextChunk priority={10}>b</TextChunk>
						</>
					);
				}
			}
			class Wrap2 extends PromptElement {
				render() {
					return (
						<>
							<TextChunk priority={2}>c</TextChunk>
							<TextChunk priority={15}>d</TextChunk>
						</>
					);
				}
			}
			await assertPruningOrder(
				<>
					<UserMessage>
						<Wrap1 priority={1} />
						<Wrap2 priority={2} />
					</UserMessage>
				</>,
				['a', 'b', 'c', 'd']
			);
		});

		test('balances priorities of equal children', async () => {
			class Wrap1 extends PromptElement {
				render() {
					return (
						<>
							<TextChunk priority={1}>a</TextChunk>
							<TextChunk priority={10}>b</TextChunk>
						</>
					);
				}
			}
			class Wrap2 extends PromptElement {
				render() {
					return (
						<>
							<TextChunk priority={2}>c</TextChunk>
							<TextChunk priority={15}>d</TextChunk>
						</>
					);
				}
			}
			await assertPruningOrder(
				<>
					<UserMessage>
						<Wrap1 />
						<Wrap2 />
					</UserMessage>
				</>,
				['a', 'c', 'b', 'd']
			);
		});

		test('priority list', async () => {
			await assertPruningOrder(
				<UserMessage>
					<PrioritizedList priority={1} descending={false}>
						<TextChunk>a</TextChunk>
						<TextChunk>b</TextChunk>
						<TextChunk>c</TextChunk>
					</PrioritizedList>
					<PrioritizedList priority={2} descending={true}>
						<TextChunk>d</TextChunk>
						<TextChunk>e</TextChunk>
						<TextChunk>f</TextChunk>
					</PrioritizedList>
				</UserMessage>,
				['a', 'b', 'c', 'f', 'e', 'd']
			);
		});

		test('balances priorities of equal across chat messages', async () => {
			await assertPruningOrder(
				<>
					<UserMessage>
						<TextChunk priority={1}>a</TextChunk>
						<TextChunk priority={10}>b</TextChunk>
					</UserMessage>
					<SystemMessage>
						<TextChunk priority={2}>c</TextChunk>
						<TextChunk priority={15}>d</TextChunk>
					</SystemMessage>
				</>,
				['a', 'c', 'b', 'd']
			);
		});

		test('scopes priorities in messages', async () => {
			await assertPruningOrder(
				<>
					<UserMessage priority={1}>
						<TextChunk priority={1}>a</TextChunk>
						<TextChunk priority={10}>b</TextChunk>
					</UserMessage>
					<SystemMessage priority={2}>
						<TextChunk priority={2}>c</TextChunk>
						<TextChunk priority={15}>d</TextChunk>
					</SystemMessage>
				</>,
				['a', 'b', 'c', 'd']
			);
		});

		test('uses legacy prioritization', async () => {
			class Wrap1 extends PromptElement {
				render() {
					return (
						<>
							<TextChunk priority={1}>a</TextChunk>
							<TextChunk priority={10}>b</TextChunk>
						</>
					);
				}
			}
			class Wrap2 extends PromptElement {
				render() {
					return (
						<>
							<TextChunk priority={2}>c</TextChunk>
							<TextChunk priority={15}>d</TextChunk>
						</>
					);
				}
			}
			await assertPruningOrder(
				<LegacyPrioritization>
					<UserMessage>
						<Wrap1 priority={1} />
						<Wrap2 priority={2} />
					</UserMessage>
					<UserMessage>
						<TextChunk priority={5}>e</TextChunk>
					</UserMessage>
				</LegacyPrioritization>,
				['a', 'c', 'e', 'b', 'd']
			);
		});

		class SimpleWrapper extends PromptElement {
			render() {
				return <>{this.props.children}</>;
			}
		}

		test('passes priority simple', async () => {
			await assertPruningOrder(
				<>
					<UserMessage priority={1}>
						<TextChunk priority={1}>a</TextChunk>
						<SimpleWrapper passPriority>
							<TextChunk priority={2}>b</TextChunk>
							<TextChunk priority={5}>e</TextChunk>
						</SimpleWrapper>
						<TextChunk priority={3}>c</TextChunk>
						<TextChunk priority={4}>d</TextChunk>
					</UserMessage>
				</>,
				['a', 'b', 'c', 'd', 'e']
			);
		});

		test('passes priority with tool', async () => {
			class MyElement extends PromptElement {
				render() {
					return (
						<>
							<TextChunk priority={1}>a</TextChunk>
							<SimpleWrapper passPriority>
								<TextChunk priority={2}>b</TextChunk>
								<TextChunk priority={5}>e</TextChunk>
							</SimpleWrapper>
							<TextChunk priority={3}>c</TextChunk>
							<TextChunk priority={4}>d</TextChunk>
						</>
					);
				}
			}
			const r = await renderElementJSON(
				MyElement,
				{},
				{
					tokenBudget: 100,
					countTokens: t =>
						Promise.resolve(
							tokenizer.tokenLength({ type: Raw.ChatCompletionContentPartKind.Text, text: t })
						),
				}
			);

			await assertPruningOrder(
				<>
					<UserMessage priority={1}>
						<ToolResult
							priority={50}
							data={new LanguageModelToolResult([new LanguageModelPromptTsxPart(r)])}
						/>
					</UserMessage>
				</>,
				['a', 'b', 'c', 'd', 'e']
			);
		});

		test('keepWith using tool', async () => {
			class MyElement extends PromptElement {
				render() {
					const KeepWith1 = useKeepWith();
					const KeepWith2 = useKeepWith();
					const KeepWith3 = useKeepWith();

					return (
						<>
							<KeepWith1 priority={1}>
								<TextChunk priority={1}>a</TextChunk>
								<TextChunk priority={2}>b</TextChunk>
							</KeepWith1>
							<KeepWith1 priority={2}>
								<KeepWith2>
									<TextChunk>c#</TextChunk>
								</KeepWith2>
								<TextChunk>c</TextChunk>
							</KeepWith1>
							<KeepWith1 priority={3}>
								<TextChunk>d</TextChunk>
							</KeepWith1>
							<KeepWith2 priority={4}>
								<TextChunk>e</TextChunk>
							</KeepWith2>
							<KeepWith3 priority={5}>f</KeepWith3>
						</>
					);
				}
			}
			const r = await renderElementJSON(
				MyElement,
				{},
				{
					tokenBudget: 100,
					countTokens: t =>
						Promise.resolve(
							tokenizer.tokenLength({ type: Raw.ChatCompletionContentPartKind.Text, text: t })
						),
				}
			);

			const it = await pruneDown(
				<>
					<UserMessage priority={1}>
						<ToolResult
							priority={50}
							data={new LanguageModelToolResult([new LanguageModelPromptTsxPart(r)])}
						/>
					</UserMessage>
				</>
			);

			let messages: string[] = [];
			for await (const m of it) {
				messages.push(m.map(strFrom).join(''));
			}

			assert.deepStrictEqual(messages, ['a\nb\nc#\nc\nd\ne\nf', 'b\nc#\nc\nd\ne\nf', 'f', '']);
		});

		test('passes priority nested', async () => {
			await assertPruningOrder(
				<>
					<UserMessage priority={1}>
						<TextChunk priority={1}>a</TextChunk>
						<SimpleWrapper passPriority>
							<SimpleWrapper passPriority>
								<TextChunk priority={2}>b</TextChunk>
							</SimpleWrapper>
							<TextChunk priority={5}>e</TextChunk>
						</SimpleWrapper>
						<TextChunk priority={3}>c</TextChunk>
						<TextChunk priority={4}>d</TextChunk>
					</UserMessage>
				</>,
				['a', 'b', 'c', 'd', 'e']
			);
		});

		test('does not inherit priority to extrinsics any more (vscode-copilot-release#5148)', async () => {
			class Wrap extends PromptElement {
				render() {
					return <>{this.props.children}</>;
				}
			}

			await assertPruningOrder(
				<>
					<UserMessage priority={1}>
						<Wrap priority={1}>a</Wrap>
						<Wrap priority={2}>b</Wrap>
						<Wrap>c</Wrap>
					</UserMessage>
				</>,
				['a', 'b', 'c']
			);
		});
	});

	suite('truncates tokens exceeding token budget', async () => {
		class Prompt1 extends PromptElement {
			render(_: void, sizing: PromptSizing) {
				return (
					<>
						<SystemMessage priority={1000}>
							You are a helpful assistant that cheers people up.
						</SystemMessage>
						<SystemMessage priority={900} name="example_user">
							How are you?
						</SystemMessage>
						<SystemMessage priority={900} name="example_assistant">
							I am fantastic. How are you?
						</SystemMessage>
						<SystemMessage priority={100} name="example_user">
							What time is it?
						</SystemMessage>
						<SystemMessage priority={100} name="example_assistant">
							It's high time to be happy!
						</SystemMessage>
						<SystemMessage priority={700} name="example_user">
							What is your name?
						</SystemMessage>
						<SystemMessage priority={700} name="example_assistant">
							My name is Happy Copilot.
						</SystemMessage>
						<UserMessage priority={499}>Hello, how are you?</UserMessage>
						<AssistantMessage priority={500}>I am terrific, how are you?</AssistantMessage>
						<UserMessage priority={900}>What time is it?</UserMessage>
					</>
				);
			}
		}

		test('no shaving', async () => {
			const res = await renderWithMaxPromptTokens(8192, Prompt1, {});
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.System,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: 'You are a helpful assistant that cheers people up.',
						},
					],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_user',
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'How are you?' }],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_assistant',
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'I am fantastic. How are you?' },
					],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_user',
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'What time is it?' }],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_assistant',
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: "It's high time to be happy!" },
					],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_user',
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'What is your name?' }],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_assistant',
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'My name is Happy Copilot.' },
					],
				},
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Hello, how are you?' }],
				},
				{
					role: Raw.ChatRole.Assistant,
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'I am terrific, how are you?' },
					],
				},
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'What time is it?' }],
				},
			]);
			assert.deepStrictEqual(res.tokenCount, 130 - BaseTokensPerCompletion);
		});

		test('no shaving at limit', async () => {
			const res = await renderWithMaxPromptTokens(130, Prompt1, {});
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.System,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: 'You are a helpful assistant that cheers people up.',
						},
					],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_user',
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'How are you?' }],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_assistant',
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'I am fantastic. How are you?' },
					],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_user',
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'What time is it?' }],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_assistant',
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: "It's high time to be happy!" },
					],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_user',
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'What is your name?' }],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_assistant',
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'My name is Happy Copilot.' },
					],
				},
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Hello, how are you?' }],
				},
				{
					role: Raw.ChatRole.Assistant,
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'I am terrific, how are you?' },
					],
				},
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'What time is it?' }],
				},
			]);
			assert.deepStrictEqual(res.tokenCount, 130 - BaseTokensPerCompletion);
		});

		test('shaving one', async () => {
			const res = await renderWithMaxPromptTokens(129 - BaseTokensPerCompletion, Prompt1, {});
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.System,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: 'You are a helpful assistant that cheers people up.',
						},
					],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_user',
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'How are you?' }],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_assistant',
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'I am fantastic. How are you?' },
					],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_assistant',
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: "It's high time to be happy!" },
					],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_user',
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'What is your name?' }],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_assistant',
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'My name is Happy Copilot.' },
					],
				},
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Hello, how are you?' }],
				},
				{
					role: Raw.ChatRole.Assistant,
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'I am terrific, how are you?' },
					],
				},
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'What time is it?' }],
				},
			]);
			assert.deepStrictEqual(res.tokenCount, 118 - BaseTokensPerCompletion);
		});

		test('shaving two', async () => {
			const res = await renderWithMaxPromptTokens(110 - BaseTokensPerCompletion, Prompt1, {});
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.System,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: 'You are a helpful assistant that cheers people up.',
						},
					],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_user',
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'How are you?' }],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_assistant',
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'I am fantastic. How are you?' },
					],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_user',
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'What is your name?' }],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_assistant',
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'My name is Happy Copilot.' },
					],
				},
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Hello, how are you?' }],
				},
				{
					role: Raw.ChatRole.Assistant,
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'I am terrific, how are you?' },
					],
				},
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'What time is it?' }],
				},
			]);
			assert.deepStrictEqual(res.tokenCount, 102 - BaseTokensPerCompletion);
		});

		test('shaving a lot', async () => {
			const res = await renderWithMaxPromptTokens(54 - BaseTokensPerCompletion, Prompt1, {});
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.System,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: 'You are a helpful assistant that cheers people up.',
						},
					],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_user',
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'How are you?' }],
				},
				{
					role: Raw.ChatRole.System,
					name: 'example_assistant',
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'I am fantastic. How are you?' },
					],
				},
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'What time is it?' }],
				},
			]);
			assert.deepStrictEqual(res.tokenCount, 53 - BaseTokensPerCompletion);
		});
	});
	suite('renders prompts based on dynamic token budget', function () {
		class FooPromptElement extends PromptElement<
			{ text: string } & BasePromptElementProps,
			{ allText: string }
		> {
			constructor(props: { text: string } & BasePromptElementProps) {
				super(props);
			}

			override async prepare(sizing: PromptSizing) {
				// Look at the token budget we've been given
				let consumedTokens = 0;
				let allText = '';
				while (consumedTokens < sizing.tokenBudget) {
					consumedTokens += this.props.text.length;
					allText += this.props.text;
				}
				return { allText };
			}
			render(state: { allText: string }) {
				return <>{state.allText}</>;
			}
		}

		class FlexPrompt extends PromptElement {
			render() {
				return (
					<>
						<SystemMessage flexBasis={2}>
							<FooPromptElement flexBasis={2} text={'Foo'} />
							<FooPromptElement flexBasis={3} text={'Bar'} />
						</SystemMessage>
						<UserMessage flexBasis={1}>
							<FooPromptElement text={'Foo'} />
						</UserMessage>
						<UserMessage flexBasis={4}>
							<FooPromptElement text={'Foo'} />
						</UserMessage>
					</>
				);
			}
		}

		test('passes budget to children based on declared flex', async () => {
			const fakeEndpoint: any = {
				modelMaxPromptTokens: 100 - BaseTokensPerCompletion, // Total allowed tokens
			} satisfies Partial<IChatEndpointInfo>;
			const inst = new PromptRenderer(fakeEndpoint, FlexPrompt, {}, tokenizer);
			const res = await inst.render(undefined, undefined);

			// Ensure that the prompt received budget based on the flex
			assert.ok(strFrom(res.messages[0]) > strFrom(res.messages[1]));
			assert.ok(strFrom(res.messages[2]) > strFrom(res.messages[0]));

			// Ensure that children received budget based on the parent budget
			const firstMessageContent = strFrom(res.messages[0]);
			const barPartStart = firstMessageContent.indexOf('Bar');
			const fooPart = firstMessageContent.slice(0, barPartStart);
			const barPart = firstMessageContent.slice(barPartStart);
			assert.ok(fooPart.length > 0);
			assert.ok(barPart.length > 0);
			assert.ok(fooPart.length < barPart.length);
		});
	});

	suite('supports prioritizing and shaving chunks within a message', function () {
		class PromptWithChunks extends PromptElement {
			render() {
				return (
					<>
						<SystemMessage>
							<TextChunk priority={21}>
								You are a helpful assistant that cheers people up.
							</TextChunk>
							<TextChunk priority={20}>
								Here are some examples of how you should respond to the user:
							</TextChunk>
							{/* TextChunks can be used to express multiline fragments within a ChatMessage with variable priority levels. */}
							<TextChunk priority={12}>
								Example 1:
								<br />
								User: "I have a list of numbers, how do I sum them?"
								<br />
								Assistant: "You can use the reduce function."
							</TextChunk>
							<TextChunk priority={11}>
								Example 2:
								<br />
								User: "What is the airspeed velocity of an unladen swallow?"
								<br />
								Assistant: "Sorry, I can't assist with that."
							</TextChunk>
							<TextChunk priority={10}>
								Example 3:
								<br />
								User: "What is the difference between map and forEach?"
								<br />
								Assistant: "The map function returns a new array, the forEach function does not."
							</TextChunk>
						</SystemMessage>
						<UserMessage>
							Here are some relevant code snippets:
							<br />
							<TextChunk priority={13}>
								```ts
								<br />
								console.log(42)
								<br />
								```
							</TextChunk>
							<TextChunk priority={9}>
								```ts
								<br />
								console.log("Don't Panic")
								<br />
								```
							</TextChunk>
						</UserMessage>
						<UserMessage priority={31}>What is your name?</UserMessage>
					</>
				);
			}
		}

		test('are rendered to chat messages', async () => {
			// First render with large token budget so nothing gets dropped
			const largeTokenBudgetEndpoint: any = {
				modelMaxPromptTokens: 8192 - BaseTokensPerCompletion,
			} satisfies Partial<IChatEndpointInfo>;
			const inst1 = new PromptRenderer(largeTokenBudgetEndpoint, PromptWithChunks, {}, tokenizer);
			const res1 = await inst1.render(undefined, undefined);
			assert.deepStrictEqual(res1.messages, [
				{
					role: Raw.ChatRole.System,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: [
								'You are a helpful assistant that cheers people up.',
								'Here are some examples of how you should respond to the user:',
								'Example 1:',
								'User: "I have a list of numbers, how do I sum them?"',
								'Assistant: "You can use the reduce function."',
								'Example 2:',
								'User: "What is the airspeed velocity of an unladen swallow?"',
								'Assistant: "Sorry, I can\'t assist with that."',
								'Example 3:',
								'User: "What is the difference between map and forEach?"',
								'Assistant: "The map function returns a new array, the forEach function does not."',
							].join('\n'),
						},
					],
				},
				{
					role: Raw.ChatRole.User,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: [
								'Here are some relevant code snippets:',
								'```ts',
								'console.log(42)',
								'```',
								'```ts',
								'console.log("Don\'t Panic")',
								'```',
							].join('\n'),
						},
					],
				},
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'What is your name?' }],
				},
			]);
			assert.deepStrictEqual(res1.tokenCount, 165 - BaseTokensPerCompletion);
		});

		test('are prioritized and fit within token budget', async () => {
			// Render with smaller token budget and ensure that messages are reduced in size
			const smallTokenBudgetEndpoint: any = {
				modelMaxPromptTokens: 140 - BaseTokensPerCompletion,
			} satisfies Partial<IChatEndpointInfo>;
			const inst2 = new PromptRenderer(smallTokenBudgetEndpoint, PromptWithChunks, {}, tokenizer);
			const res2 = await inst2.render(undefined, undefined);
			assert.deepStrictEqual(res2.messages, [
				{
					role: Raw.ChatRole.System,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: [
								'You are a helpful assistant that cheers people up.',
								'Here are some examples of how you should respond to the user:',
								'Example 1:',
								'User: "I have a list of numbers, how do I sum them?"',
								'Assistant: "You can use the reduce function."',
								'Example 2:',
								'User: "What is the airspeed velocity of an unladen swallow?"',
								'Assistant: "Sorry, I can\'t assist with that."',
							].join('\n'),
						},
					],
				},
				{
					role: Raw.ChatRole.User,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: [
								'Here are some relevant code snippets:',
								'```ts',
								'console.log(42)',
								'```',
							].join('\n'),
						},
					],
				},
			]);
			assert.equal(res2.tokenCount, 108);
		});
	});

	suite('tracks surviving prompt references', async () => {
		const variableReference = { variableName: 'foo' };
		class PromptWithReference extends PromptElement {
			render() {
				return (
					<>
						<UserMessage>
							<TextChunk>
								<references value={[new PromptReference(variableReference)]} />
								Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
								incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud
								exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute
								irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
								pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia
								deserunt mollit anim id est laborum.
							</TextChunk>
							<TextChunk>
								<references value={[new PromptReference(variableReference)]} />
								Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
								incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud
								exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute
								irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
								pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia
								deserunt mollit anim id est laborum.
							</TextChunk>
						</UserMessage>
						<UserMessage>Foo</UserMessage>
					</>
				);
			}
		}

		test('reports reference that survived prioritization', async () => {
			const endpoint: any = {
				modelMaxPromptTokens: 4096 - BaseTokensPerCompletion,
			} satisfies Partial<IChatEndpointInfo>;

			const inst = new PromptRenderer(endpoint, PromptWithReference, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.equal(res.messages.length, 2);
			assert.equal(res.references.length, 1);
			assert.equal(res.references[0].anchor, variableReference);
		});

		test('does not report reference that did not survive prioritization', async () => {
			const endpoint: any = {
				modelMaxPromptTokens: 10,
			} satisfies Partial<IChatEndpointInfo>;

			const inst = new PromptRenderer(endpoint, PromptWithReference, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.equal(res.messages.length, 1);
			assert.equal(res.references.length, 0);
			assert.equal(res.omittedReferences.length, 1);
		});

		test('reports references under nested extrinsics', async () => {
			const variableReference1 = { variableName: 'foo' };
			const variableReference2 = { variableName: 'bar' };
			class NestedTextChunkComponent extends PromptElement {
				render() {
					return (
						<TextChunk>
							<references value={[new PromptReference(variableReference2)]} />
							Bar
						</TextChunk>
					);
				}
			}
			class PromptWithReferences extends PromptElement {
				render() {
					return (
						<>
							<UserMessage>
								<references value={[new PromptReference(variableReference1)]} />
								Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
								incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud
								exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute
								irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
								pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia
								deserunt mollit anim id est laborum.
							</UserMessage>
							<UserMessage>
								<NestedTextChunkComponent />
							</UserMessage>
						</>
					);
				}
			}

			const endpoint: any = {
				modelMaxPromptTokens: 4096 - BaseTokensPerCompletion,
			} satisfies Partial<IChatEndpointInfo>;

			const inst = new PromptRenderer(endpoint, PromptWithReferences, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.equal(res.messages.length, 2);
			assert.equal(res.references.length, 2);
		});
	});

	suite('flex behavior', () => {
		const consumeRe = /consume=(\d+)/g;

		class FakeTokenizer implements ITokenizer<OutputMode.Raw> {
			readonly mode = OutputMode.Raw;
			baseTokensPerMessage = 0;
			baseTokensPerName = 0;
			baseTokensPerCompletion = 0;

			tokenLength(part: Raw.ChatCompletionContentPart): number {
				return this.countStr(strFrom(part));
			}

			countMessageTokens(message: Raw.ChatMessage): number {
				return this.countStr(strFrom(message));
			}

			private countStr(s: string) {
				let n = 0;
				for (const match of s.matchAll(consumeRe)) {
					n += Number(match[1]);
				}
				return n;
			}
		}

		interface IProps extends BasePromptElementProps {
			name: string;
			useBudget?: number;
		}
		class EchoBudget extends PromptElement<IProps, number> {
			prepare(sizing: PromptSizing): Promise<number> {
				return Promise.resolve(sizing.tokenBudget);
			}

			render(budget: number) {
				return (
					<UserMessage>
						{this.props.useBudget ? `consume=${this.props.useBudget}, ` : ''}
						{this.props.name}={budget}
					</UserMessage>
				);
			}
		}

		async function flexTest(elements: PromptPiece, expected: Raw.ChatMessage[]) {
			const inst = new PromptRenderer(
				{ modelMaxPromptTokens: 100 } satisfies Partial<IChatEndpointInfo> as IChatEndpointInfo,
				class extends PromptElement {
					render() {
						return elements;
					}
				},
				{},
				new FakeTokenizer()
			);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, expected);
		}

		test('passes budget to children based on declared flex', async () => {
			await flexTest(
				<>
					<EchoBudget name="content" useBudget={10} />
					<EchoBudget name="grow" flexGrow={1} />
				</>,
				[
					{
						content: [
							{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=10, content=100' },
						],
						role: Raw.ChatRole.User,
					},
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'grow=90' }],
						role: Raw.ChatRole.User,
					},
				]
			);
		});

		test('applies flex reserve', async () => {
			await flexTest(
				<>
					<EchoBudget name="content" useBudget={10} />
					<EchoBudget name="grow" flexGrow={1} flexReserve={20} />
				</>,
				[
					{
						content: [
							{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=10, content=80' },
						],
						role: Raw.ChatRole.User,
					},
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'grow=90' }],
						role: Raw.ChatRole.User,
					},
				]
			);
		});

		test('applies proportional flex reserve', async () => {
			await flexTest(
				<>
					<EchoBudget name="content" useBudget={10} />
					<EchoBudget name="grow1" flexGrow={1} flexReserve="/4" />
					<EchoBudget name="grow2" flexGrow={1} flexReserve="/4" />
				</>,
				[
					{
						content: [
							{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=10, content=50' },
						],
						role: Raw.ChatRole.User,
					},
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'grow1=45' }],
						role: Raw.ChatRole.User,
					},
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'grow2=45' }],
						role: Raw.ChatRole.User,
					},
				]
			);
		});

		test('shared between multiple in flex groups', async () => {
			await flexTest(
				<>
					<EchoBudget name="content" useBudget={10} />
					<EchoBudget name="grow1" flexGrow={1} />
					<EchoBudget name="grow2" flexGrow={1} />
				</>,
				[
					{
						content: [
							{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=10, content=100' },
						],
						role: Raw.ChatRole.User,
					},
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'grow1=45' }],
						role: Raw.ChatRole.User,
					},
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'grow2=45' }],
						role: Raw.ChatRole.User,
					},
				]
			);
		});

		test('does not emit empty messages', async () => {
			const inst = new PromptRenderer(
				fakeEndpoint,
				class extends PromptElement {
					render() {
						return (
							<>
								<SystemMessage></SystemMessage>
								<UserMessage>Hello!</UserMessage>
							</>
						);
					}
				},
				{},
				new FakeTokenizer()
			);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Hello!' }],
				},
			]);
		});

		test('does not add a line break in an embedded message', async () => {
			class Inner extends PromptElement {
				render() {
					return <>world</>;
				}
			}
			const inst = new PromptRenderer(
				fakeEndpoint,
				class extends PromptElement {
					render() {
						return (
							<>
								<UserMessage>
									Hello <Inner />!
								</UserMessage>
							</>
						);
					}
				},
				{},
				new FakeTokenizer()
			);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Hello world!' }],
				},
			]);
		});

		test('adds line break between two nested embedded messages', async () => {
			class Inner extends PromptElement {
				render() {
					return <>world</>;
				}
			}
			const inst = new PromptRenderer(
				fakeEndpoint,
				class extends PromptElement {
					render() {
						return (
							<>
								<UserMessage>
									<Inner />
									<Inner />
								</UserMessage>
							</>
						);
					}
				},
				{},
				new FakeTokenizer()
			);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'world\nworld' }],
				},
			]);
		});

		test('none-grow, greedy-grow, grow elements', async () => {
			await flexTest(
				<>
					<EchoBudget name="1" useBudget={5} />
					<EchoBudget name="2" useBudget={10} />
					<EchoBudget name="3" useBudget={5} />
					<EchoBudget name="grow4" flexGrow={2} useBudget={1} />
					<EchoBudget name="grow5" flexGrow={3} useBudget={79} />
				</>,
				[
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=5, 1=33' }],
						role: Raw.ChatRole.User,
					},
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=10, 2=33' }],
						role: Raw.ChatRole.User,
					},
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=5, 3=33' }],
						role: Raw.ChatRole.User,
					},
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=1, grow4=1' }],
						role: Raw.ChatRole.User,
					},
					{
						content: [
							{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=79, grow5=80' },
						],
						role: Raw.ChatRole.User,
					},
				]
			);
		});

		test('none-grow, greedy-grow, grow elements, nested', async () => {
			class StringEchoBudget extends PromptElement<IProps, number> {
				prepare(sizing: PromptSizing): Promise<number> {
					return Promise.resolve(sizing.tokenBudget);
				}
				render(budget: number) {
					return (
						<>
							{this.props.useBudget ? `consume=${this.props.useBudget}, ` : ''}
							{this.props.name}={budget}
						</>
					);
				}
			}

			await flexTest(
				<>
					<UserMessage>
						<StringEchoBudget name="1" useBudget={5} />
						<StringEchoBudget name="2" useBudget={10} />
						<StringEchoBudget name="3" useBudget={5} />
						<StringEchoBudget name="grow4" flexGrow={2} useBudget={1} />
						<StringEchoBudget name="grow5" flexGrow={3} useBudget={79} />
					</UserMessage>
				</>,
				[
					{
						content: [
							{
								type: Raw.ChatCompletionContentPartKind.Text,
								text: [
									'consume=5, 1=33',
									'consume=10, 2=33',
									'consume=5, 3=33',
									'consume=1, grow4=1',
									'consume=79, grow5=80',
								].join('\n'),
							},
						],
						role: Raw.ChatRole.User,
					},
				]
			);
		});

		test('counts budget used in nested elements', async () => {
			class Nested extends PromptElement {
				render() {
					return <NestedB />;
				}
			}
			class NestedB extends PromptElement<BasePromptElementProps, number> {
				async prepare() {
					return Promise.resolve(42);
				}
				render(consume: number) {
					return <SystemMessage>{`consume=${consume}`}</SystemMessage>;
				}
			}
			await flexTest(
				<>
					<Nested />
					<EchoBudget name="grow1" flexGrow={1} />
					<EchoBudget name="grow2" flexGrow={1} />
				</>,
				[
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=42' }],
						role: Raw.ChatRole.System,
					},
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'grow1=29' }],
						role: Raw.ChatRole.User,
					},
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'grow2=29' }],
						role: Raw.ChatRole.User,
					},
				]
			);
		});

		test('all together now 🙌', async () => {
			await flexTest(
				<>
					<EchoBudget name="content1" useBudget={10} />
					<EchoBudget name="content2" useBudget={20} flexBasis={2} />
					<EchoBudget name="grow2a" flexGrow={2} flexReserve={20} useBudget={15} />
					<EchoBudget name="grow1a" flexGrow={1} flexReserve={10} />
					<EchoBudget name="grow1b" flexGrow={1} flexReserve={10} flexBasis={2} />
					<EchoBudget name="grow2b" flexGrow={2} flexReserve={20} useBudget={20} />
				</>,
				[
					{
						content: [
							{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=10, content1=13' },
						], // non-flex elements have 40 unreserved budget, #2 uses flex=2 to get a bigger share
						role: Raw.ChatRole.User,
					},
					{
						content: [
							{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=20, content2=26' },
						],
						role: Raw.ChatRole.User,
					},

					{
						content: [
							{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=15, grow2a=25' },
						], // 70 budget left over, 20 reserved, shared between flexGrow=2
						role: Raw.ChatRole.User,
					},

					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'grow1a=11' }], // 35 used, b asked for a larger share
						role: Raw.ChatRole.User,
					},
					{
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'grow1b=23' }],
						role: Raw.ChatRole.User,
					},

					{
						content: [
							{ type: Raw.ChatCompletionContentPartKind.Text, text: 'consume=20, grow2b=25' },
						],
						role: Raw.ChatRole.User,
					},
				]
			);
		});
	});

	suite('renderElementJSON', () => {
		test('scopes priorities', async () => {
			const json = await renderElementJSON(
				class extends PromptElement {
					render() {
						return (
							<>
								<TextChunk priority={50}>hello50</TextChunk>
								<TextChunk priority={60}>hello60</TextChunk>
								<TextChunk priority={70}>hello70</TextChunk>
								<TextChunk priority={80}>hello80</TextChunk>
								<TextChunk priority={90}>hello90</TextChunk>
							</>
						);
					}
				},
				{},
				{
					tokenBudget: 100,
					countTokens: t =>
						Promise.resolve(
							tokenizer.tokenLength({
								type: Raw.ChatCompletionContentPartKind.Text,
								text: t,
							})
						),
				}
			);

			const actual = await new PromptRenderer(
				{ modelMaxPromptTokens: 20 } as any,
				class extends PromptElement {
					render() {
						return (
							<UserMessage>
								<TextChunk priority={40}>outer40</TextChunk>
								<ToolResult
									priority={50}
									data={new LanguageModelToolResult([new LanguageModelPromptTsxPart(json)])}
								/>
								<TextChunk priority={60}>outer60</TextChunk>
								<TextChunk priority={70}>outer70</TextChunk>
								<TextChunk priority={80}>outer80</TextChunk>
								<TextChunk priority={90}>outer90</TextChunk>
							</UserMessage>
						);
					}
				},
				{},
				tokenizer
			).render();

			// if priorities were not scoped, we'd see hello80 here instead of outer70
			assert.strictEqual(
				strFrom(actual.messages[0]),
				'hello90\nouter60\nouter70\nouter80\nouter90'
			);
		});

		test('round trips messages', async () => {
			class MyElement extends PromptElement {
				render() {
					return (
						<>
							Hello world!
							<TextChunk priority={10}>
								chunk1
								<references
									value={[new PromptReference({ variableName: 'foo', value: undefined })]}
								/>
							</TextChunk>
							<TextChunk priority={20}>chunk2</TextChunk>
						</>
					);
				}
			}
			const r = await renderElementJSON(
				MyElement,
				{},
				{
					tokenBudget: 100,
					countTokens: t =>
						Promise.resolve(
							tokenizer.tokenLength({
								type: Raw.ChatCompletionContentPartKind.Text,
								text: t,
							})
						),
				}
			);

			const expected = await new PromptRenderer(
				fakeEndpoint,
				class extends PromptElement {
					render() {
						return (
							<UserMessage>
								<MyElement />
							</UserMessage>
						);
					}
				},
				{},
				tokenizer
			).render();

			const actual = await new PromptRenderer(
				fakeEndpoint,
				class extends PromptElement {
					render() {
						return (
							<UserMessage>
								<ToolResult
									priority={50}
									data={new LanguageModelToolResult([new LanguageModelPromptTsxPart(r)])}
								/>
							</UserMessage>
						);
					}
				},
				{},
				tokenizer
			).render();

			assert.deepStrictEqual(actual.messages, expected.messages);
			assert.deepStrictEqual(actual.references, expected.references);
		});
	});

	test('correct ordering of child text chunks (#90)', async () => {
		class Wrapper extends PromptElement {
			render() {
				return (
					<>
						inbefore
						<br />
						{this.props.children}
						inafter
						<br />
					</>
				);
			}
		}
		class Outer extends PromptElement {
			render() {
				return (
					<UserMessage>
						before
						<br />
						<Wrapper>
							<TextChunk>
								wrapped
								<br />
							</TextChunk>
						</Wrapper>
						after
					</UserMessage>
				);
			}
		}

		const inst = new PromptRenderer(fakeEndpoint, Outer, {}, tokenizer);
		const res = await inst.render(undefined, undefined);
		assert.deepStrictEqual(
			res.messages.map(m => strFrom(m)).join('\n'),
			['before', 'inbefore', 'wrapped', 'inafter', 'after'].join('\n')
		);
	});

	suite('metadata', () => {
		class MyMeta extends PromptMetadata {
			constructor(public cool: boolean) {
				super();
			}
		}

		test('is extractable and global', async () => {
			const res = await new PromptRenderer(
				{ modelMaxPromptTokens: Number.MAX_SAFE_INTEGER } as any,
				class extends PromptElement {
					render() {
						return (
							<UserMessage>
								Hello world!
								<meta value={new MyMeta(true)} />
							</UserMessage>
						);
					}
				},
				{},
				tokenizer
			).render();

			assert.deepStrictEqual(res.metadata.get(MyMeta), new MyMeta(true));
		});

		test('local survives when chunk survives', async () => {
			const res = await new PromptRenderer(
				{ modelMaxPromptTokens: Number.MAX_SAFE_INTEGER } as any,
				class extends PromptElement {
					render() {
						return (
							<UserMessage>
								<TextChunk>
									Hello <meta value={new MyMeta(true)} local />
								</TextChunk>
								<TextChunk>world!</TextChunk>
							</UserMessage>
						);
					}
				},
				{},
				tokenizer
			).render();

			assert.deepStrictEqual(res.metadata.get(MyMeta), new MyMeta(true));
		});

		test('local is pruned when chunk is pruned', async () => {
			const res = await new PromptRenderer(
				{ modelMaxPromptTokens: 1 } as any,
				class extends PromptElement {
					render() {
						return (
							<UserMessage>
								<TextChunk priority={1}>
									Hello <meta value={new MyMeta(true)} local />
								</TextChunk>
								<TextChunk>world!</TextChunk>
							</UserMessage>
						);
					}
				},
				{},
				tokenizer
			).render();

			assert.deepStrictEqual(res.metadata.get(MyMeta), undefined);
		});

		test('global survives when chunk is pruned', async () => {
			const res = await new PromptRenderer(
				{ modelMaxPromptTokens: 5 } as any,
				class extends PromptElement {
					render() {
						return (
							<UserMessage>
								<TextChunk priority={1}>
									Hello <meta value={new MyMeta(true)} />
								</TextChunk>
								<TextChunk>world!</TextChunk>
							</UserMessage>
						);
					}
				},
				{},
				tokenizer
			).render();

			assert.deepStrictEqual(res.metadata.get(MyMeta), new MyMeta(true));
		});

		test('can return multiple instances', async () => {
			const res = await new PromptRenderer(
				{ modelMaxPromptTokens: Number.MAX_SAFE_INTEGER } as any,
				class extends PromptElement {
					render() {
						return (
							<UserMessage>
								Hello world!
								<meta value={new MyMeta(true)} />
								<meta value={new MyMeta(false)} />
							</UserMessage>
						);
					}
				},
				{},
				tokenizer
			).render();

			assert.deepStrictEqual(res.metadata.getAll(MyMeta), [new MyMeta(true), new MyMeta(false)]);
		});
	});

	suite('growable', () => {
		test('grows basic', async () => {
			const sizingInCalls: number[] = [];
			const res = await new PromptRenderer(
				{ modelMaxPromptTokens: 50 },
				class extends PromptElement {
					render() {
						return (
							<UserMessage>
								<Expandable
									value={async sizing => {
										sizingInCalls.push(sizing.tokenBudget);
										let str = 'hi';
										while (
											(await sizing.countTokens({
												type: Raw.ChatCompletionContentPartKind.Text,
												text: str + 'a',
											})) <= sizing.tokenBudget
										) {
											str += 'a';
										}
										return str;
									}}
								/>
								<TextChunk>smaller</TextChunk>
							</UserMessage>
						);
					}
				},
				{},
				tokenizer
			).render();

			assert.deepStrictEqual(sizingInCalls, [23, 43]);
			assert.strictEqual(res.tokenCount, 50);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: 'hiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nsmaller',
						},
					],
				},
			]);
		});

		test('grows multiple in render order and uses budget', async () => {
			const sizingInCalls: string[] = [];
			const res = await new PromptRenderer(
				{ modelMaxPromptTokens: 50 },
				class extends PromptElement {
					render() {
						return (
							<UserMessage>
								<Expandable
									flexGrow={1}
									value={async sizing => {
										let str = 'hi';
										while (
											(await sizing.countTokens({
												type: Raw.ChatCompletionContentPartKind.Text,
												text: str + 'a',
											})) <
											sizing.tokenBudget / 2
										) {
											str += 'a';
										}
										sizingInCalls.push(`a=${sizing.tokenBudget}`);
										return str;
									}}
								/>
								<Expandable
									value={async sizing => {
										let str = 'hi';
										while (
											(await sizing.countTokens({
												type: Raw.ChatCompletionContentPartKind.Text,
												text: str + 'b',
											})) <
											sizing.tokenBudget / 2
										) {
											str += 'b';
										}
										sizingInCalls.push(`b=${sizing.tokenBudget}`);
										return str;
									}}
								/>
								<TextChunk>smaller</TextChunk>
							</UserMessage>
						);
					}
				},
				{},
				tokenizer
			).render();

			assert.deepStrictEqual(sizingInCalls, ['b=23', 'a=33', 'b=26', 'a=30']);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: 'hiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nhibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\nsmaller',
						},
					],
				},
			]);
			assert.strictEqual(res.tokenCount, 34);
		});

		test('stops growing early if over budget', async () => {
			const sizingInCalls: string[] = [];
			const res = await new PromptRenderer(
				{ modelMaxPromptTokens: 50 },
				class extends PromptElement {
					render() {
						return (
							<UserMessage>
								<Expandable
									flexGrow={1}
									value={async sizing => {
										sizingInCalls.push(`a=${sizing.tokenBudget}`);
										return 'hi';
									}}
								/>
								<Expandable
									value={async sizing => {
										sizingInCalls.push(`b=${sizing.tokenBudget}`);
										if (sizing.tokenBudget < 30) {
											return 'hi';
										}
										let str = 'hi';
										while (
											(await sizing.countTokens({
												type: Raw.ChatCompletionContentPartKind.Text,
												text: str + 'a',
											})) <= sizing.tokenBudget
										) {
											str += 'a';
										}
										return str;
									}}
								/>
								<TextChunk>smaller</TextChunk>
							</UserMessage>
						);
					}
				},
				{},
				tokenizer
			).render();

			assert.deepStrictEqual(sizingInCalls, ['b=23', 'a=43', 'b=41']);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: 'hi\nhiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nsmaller',
						},
					],
				},
			]);
		});

		test('still prunes over budget', async () => {
			const sizingInCalls: string[] = [];
			const res = await new PromptRenderer(
				{ modelMaxPromptTokens: 50 },
				class extends PromptElement {
					render() {
						return (
							<UserMessage>
								<Expandable
									flexGrow={1}
									value={async sizing => {
										sizingInCalls.push(`a=${sizing.tokenBudget}`);
										return 'hi';
									}}
								/>
								<Expandable
									value={async sizing => {
										sizingInCalls.push(`b=${sizing.tokenBudget}`);
										if (sizing.tokenBudget < 30) {
											return 'hi';
										}
										return 'hi'.repeat(1000);
									}}
								/>
								<TextChunk>smaller</TextChunk>
							</UserMessage>
						);
					}
				},
				{},
				tokenizer
			).render();

			assert.deepStrictEqual(sizingInCalls, ['b=23', 'a=43', 'b=41']);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'smaller' }],
				},
			]);
		});
	});

	test('supports iterable children', async () => {
		class Wrapper extends PromptElement {
			render() {
				return (
					<UserMessage>
						hello
						{(function* () {
							yield ' everyone';
							yield ' in';
							yield ' the ';
						})()}
						world!
					</UserMessage>
				);
			}
		}

		const inst = new PromptRenderer(fakeEndpoint, Wrapper, {}, tokenizer);
		const res = await inst.render(undefined, undefined);
		assert.deepStrictEqual(res.messages.map(strFrom).join(''), 'hello everyone in the world!');
	});

	suite('TokenLimit', () => {
		test('limits tokens within budget', async () => {
			class PromptWithLimit extends PromptElement {
				render() {
					return (
						<UserMessage>
							<TextChunk priority={1}>outside</TextChunk>
							<TokenLimit max={7} priority={10}>
								<PrioritizedList descending={true}>
									<TextChunk>12345</TextChunk>
									<TextChunk>67890</TextChunk>
									<TextChunk>extra</TextChunk>
								</PrioritizedList>
							</TokenLimit>
						</UserMessage>
					);
				}
			}

			const inst = new PromptRenderer(fakeEndpoint, PromptWithLimit, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'outside\n12345\n67890' },
					],
				},
			]);
		});

		test('child elements get lower token limit', async () => {
			class Wrapper extends PromptElement<{ expected: number } & BasePromptElementProps> {
				render(_: void, sizing: PromptSizing) {
					assert.strictEqual(sizing.tokenBudget, this.props.expected);
					return <>asdf</>;
				}
			}

			class PromptWithLimit extends PromptElement {
				render() {
					return (
						<UserMessage>
							<Wrapper expected={8175} />
							<TokenLimit max={10} priority={10}>
								<Wrapper expected={10} />
							</TokenLimit>
						</UserMessage>
					);
				}
			}

			const inst = new PromptRenderer(fakeEndpoint, PromptWithLimit, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'asdf\nasdf' }],
				},
			]);
		});

		test('does not redistribute with higher than proportionate limit', async () => {
			class Wrapper extends PromptElement<{ expected: number } & BasePromptElementProps> {
				render(_: void, sizing: PromptSizing) {
					assert.strictEqual(sizing.tokenBudget, this.props.expected);
					return <>asdf</>;
				}
			}

			class PromptWithLimit extends PromptElement {
				render() {
					return (
						<UserMessage>
							<Wrapper expected={4092} />
							<TokenLimit max={10000} priority={10}>
								<Wrapper expected={4092} />
							</TokenLimit>
						</UserMessage>
					);
				}
			}

			const inst = new PromptRenderer(fakeEndpoint, PromptWithLimit, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'asdf\nasdf' }],
				},
			]);
		});

		test('works with multiple', async () => {
			class Wrapper extends PromptElement<{ expected: number } & BasePromptElementProps> {
				render(_: void, sizing: PromptSizing) {
					assert.strictEqual(sizing.tokenBudget, this.props.expected);
					return <>asdf</>;
				}
			}

			class PromptWithLimit extends PromptElement {
				render() {
					return (
						<UserMessage>
							<Wrapper expected={2695} />
							<Wrapper expected={2695} />
							{/* Included in distribution */}
							<TokenLimit max={100} priority={10}>
								<Wrapper expected={100} />
							</TokenLimit>
							{/* excluded from distribution because of large size */}
							<TokenLimit max={10000} priority={10}>
								<Wrapper expected={2695} />
							</TokenLimit>
						</UserMessage>
					);
				}
			}

			const inst = new PromptRenderer(fakeEndpoint, PromptWithLimit, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'asdf\nasdf\nasdf\nasdf' },
					],
				},
			]);
		});

		test('limits if nested outer < inner', async () => {
			class PromptWithLimit extends PromptElement {
				render() {
					return (
						<UserMessage>
							<TokenLimit max={15} priority={10}>
								<PrioritizedList descending={true} priority={10}>
									<TextChunk>12345</TextChunk>
									<TextChunk>67890</TextChunk>
									<TextChunk>extra</TextChunk>
								</PrioritizedList>
								<TokenLimit max={100} priority={15}>
									<PrioritizedList descending={true}>
										<TextChunk>12345</TextChunk>
										<TextChunk>67890</TextChunk>
										<TextChunk>extra</TextChunk>
									</PrioritizedList>
								</TokenLimit>
							</TokenLimit>
						</UserMessage>
					);
				}
			}

			const inst = new PromptRenderer(fakeEndpoint, PromptWithLimit, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: '12345\n67890\n12345\n67890\nextra',
						},
					],
				},
			]);
		});

		test('limits if nested outer > inner', async () => {
			class PromptWithLimit extends PromptElement {
				render() {
					return (
						<UserMessage>
							<TokenLimit max={15} priority={10}>
								<PrioritizedList descending={true} priority={10}>
									<TextChunk>12345</TextChunk>
									<TextChunk>67890</TextChunk>
									<TextChunk>extra</TextChunk>
								</PrioritizedList>
								<TokenLimit max={7} priority={5}>
									<PrioritizedList descending={true}>
										<TextChunk>12345</TextChunk>
										<TextChunk>67890</TextChunk>
										<TextChunk>extra</TextChunk>
									</PrioritizedList>
								</TokenLimit>
							</TokenLimit>
						</UserMessage>
					);
				}
			}

			const inst = new PromptRenderer(fakeEndpoint, PromptWithLimit, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Text,
							text: '12345\n67890\nextra\n12345\n67890',
						},
					],
				},
			]);
		});
	});

	suite('BaseImageMessage', () => {
		test('renders image: jpeg', async () => {
			class PromptWithImage extends PromptElement {
				render() {
					return (
						<UserMessage>
							<BaseImageMessage src={'/9j/asdfasdfasdf'} detail={'high'} />
						</UserMessage>
					);
				}
			}

			const inst = new PromptRenderer(fakeEndpoint, PromptWithImage, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Image,
							imageUrl: { url: 'data:image/jpeg;base64,/9j/asdfasdfasdf', detail: 'high' },
						},
					],
				},
			]);
		});

		test('renders image: png', async () => {
			class PromptWithImage extends PromptElement {
				render() {
					return (
						<UserMessage>
							<BaseImageMessage src={'iVBORasdfasdfasdf'} detail={'high'} />
						</UserMessage>
					);
				}
			}

			const inst = new PromptRenderer(fakeEndpoint, PromptWithImage, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Image,
							imageUrl: { url: 'data:image/png;base64,iVBORasdfasdfasdf', detail: 'high' },
						},
					],
				},
			]);
		});

		test('renders image: gif', async () => {
			class PromptWithImage extends PromptElement {
				render() {
					return (
						<UserMessage>
							<BaseImageMessage src={'R0lGODasdfasdfasdf'} detail={'low'} />
						</UserMessage>
					);
				}
			}

			const inst = new PromptRenderer(fakeEndpoint, PromptWithImage, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Image,
							imageUrl: { url: 'data:image/gif;base64,R0lGODasdfasdfasdf', detail: 'low' },
						},
					],
				},
			]);
		});

		test('renders image: webp', async () => {
			class PromptWithImage extends PromptElement {
				render() {
					return (
						<UserMessage>
							<BaseImageMessage src={'UklGRasdfasdfasdf'} detail={'low'} />
						</UserMessage>
					);
				}
			}

			const inst = new PromptRenderer(fakeEndpoint, PromptWithImage, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Image,
							imageUrl: { url: 'data:image/webp;base64,UklGRasdfasdfasdf', detail: 'low' },
						},
					],
				},
			]);
		});

		test('ensure children in image elements are dropped', async () => {
			class PromptWithImage extends PromptElement {
				render() {
					return (
						<UserMessage>
							<BaseImageMessage src={'iVBORasdfasdfasdf'} detail={'high'}>
								Child in Base Image Message
							</BaseImageMessage>
						</UserMessage>
					);
				}
			}

			const inst = new PromptRenderer(fakeEndpoint, PromptWithImage, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Image,
							imageUrl: { url: 'data:image/png;base64,iVBORasdfasdfasdf', detail: 'high' },
						},
					],
				},
			]);
		});

		test('text and image together (text before image)', async () => {
			class PromptWithImage extends PromptElement {
				render() {
					return (
						<UserMessage>
							<TextChunk>some text in a text chunk</TextChunk>
							<BaseImageMessage src={'iVBORasdfasdfasdf'} detail={'high'} />
							{/* <TextChunk>some text in a text chunk</TextChunk> */}
						</UserMessage>
					);
				}
			}

			const inst = new PromptRenderer(fakeEndpoint, PromptWithImage, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{ text: 'some text in a text chunk', type: Raw.ChatCompletionContentPartKind.Text },
						{
							type: Raw.ChatCompletionContentPartKind.Image,
							imageUrl: { url: 'data:image/png;base64,iVBORasdfasdfasdf', detail: 'high' },
						},
					],
				},
			]);
		});

		test('text and image together (text after image)', async () => {
			class PromptWithImage extends PromptElement {
				render() {
					return (
						<UserMessage>
							<BaseImageMessage src={'iVBORasdfasdfasdf'} detail={'high'} />
							<TextChunk>some text in a text chunk</TextChunk>
						</UserMessage>
					);
				}
			}

			const inst = new PromptRenderer(fakeEndpoint, PromptWithImage, {}, tokenizer);
			const res = await inst.render(undefined, undefined);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{
							type: Raw.ChatCompletionContentPartKind.Image,
							imageUrl: { url: 'data:image/png;base64,iVBORasdfasdfasdf', detail: 'high' },
						},
						{ text: 'some text in a text chunk', type: Raw.ChatCompletionContentPartKind.Text },
					],
				},
			]);
		});
	});

	suite('IfEmpty', () => {
		test('simple string (full)', async () => {
			const res = await renderFragmentWithMaxPromptTokens(
				Infinity,
				<UserMessage>
					<IfEmpty alt="empty alt!">Not an empty string</IfEmpty>
				</UserMessage>
			);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Not an empty string' }],
				},
			]);
		});

		test('simple string (empty)', async () => {
			const res = await renderFragmentWithMaxPromptTokens(
				Infinity,
				<UserMessage>
					<IfEmpty alt="empty alt!"> </IfEmpty>
				</UserMessage>
			);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'empty alt!' }],
				},
			]);
		});

		class Wrapper extends PromptElement<BasePromptElementProps & { x: string }> {
			render() {
				return (
					<>
						<TextChunk></TextChunk>
						<TextChunk>{this.props.x}</TextChunk>
						<Chunk></Chunk>
					</>
				);
			}
		}

		test('complex elements (full)', async () => {
			const res = await renderFragmentWithMaxPromptTokens(
				Infinity,
				<UserMessage>
					<IfEmpty alt={<Wrapper x="alternate" />}>
						<Wrapper x="hi!" />
					</IfEmpty>
				</UserMessage>
			);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'hi!' }],
				},
			]);
		});

		test('complex elements (empty)', async () => {
			const res = await renderFragmentWithMaxPromptTokens(
				Infinity,
				<UserMessage>
					<IfEmpty alt={<Wrapper x="alternate" />}>
						<Wrapper x="" />
					</IfEmpty>
				</UserMessage>
			);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'alternate' }],
				},
			]);
		});

		test('multi children (#162)', async () => {
			const res1 = await renderFragmentWithMaxPromptTokens(
				Infinity,
				<UserMessage>
					<IfEmpty alt={<Wrapper x="alternate" />}>
						<Wrapper x="a" />
						<Wrapper x="b" />
					</IfEmpty>
				</UserMessage>
			);
			assert.deepStrictEqual(res1.messages, [
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'a\nb' }],
				},
			]);

			const res2 = await renderFragmentWithMaxPromptTokens(
				Infinity,
				<UserMessage>
					<IfEmpty alt={<Wrapper x="alternate" />}>
						<Wrapper x="" />
						<Wrapper x="" />
					</IfEmpty>
				</UserMessage>
			);
			assert.deepStrictEqual(res2.messages, [
				{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'alternate' }],
				},
			]);
		});
	});

	suite('cachePoint', () => {
		test('includes in result', async () => {
			const res2 = await renderFragmentWithMaxPromptTokens(
				Infinity,
				<UserMessage>
					Hello
					<cacheCheckpoint type="ephemeral" />
					World
				</UserMessage>
			);
			assert.deepStrictEqual(res2.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Hello' },
						{ type: Raw.ChatCompletionContentPartKind.CacheCheckpoint, cacheType: 'ephemeral' },
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'World' },
					],
				},
			]);
		});

		test('preserves cache points across multiple messages', async () => {
			const res = await renderFragmentWithMaxPromptTokens(
				Infinity,
				<>
					<UserMessage>
						Hello
						<cacheCheckpoint type="ephemeral" />
						World
					</UserMessage>
					<UserMessage>
						Another
						<cacheCheckpoint type="persistent" />
						Message
					</UserMessage>
				</>
			);
			assert.deepStrictEqual(res.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Hello' },
						{ type: Raw.ChatCompletionContentPartKind.CacheCheckpoint, cacheType: 'ephemeral' },
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'World' },
					],
				},
				{
					role: Raw.ChatRole.User,
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Another' },
						{ type: Raw.ChatCompletionContentPartKind.CacheCheckpoint, cacheType: 'persistent' },
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Message' },
					],
				},
			]);
		});

		test('content before last checkpoint is never pruned', async () => {
			const res1 = await renderFragmentWithMaxPromptTokens(
				10, // small budget
				<UserMessage>
					<TextChunk priority={1}>Lorem</TextChunk>
					<TextChunk priority={2}>Ipsum</TextChunk>
					<cacheCheckpoint type="ephemeral" />
					<TextChunk priority={3}>Dolor</TextChunk>
					<TextChunk priority={4}>Sit</TextChunk>
				</UserMessage>
			);
			// Only C/D may be pruned, A/B and checkpoint must remain
			assert.deepStrictEqual(res1.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Lorem\nIpsum' },
						{ type: Raw.ChatCompletionContentPartKind.CacheCheckpoint, cacheType: 'ephemeral' },
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Sit' },
					],
				},
			]);

			const res2 = await renderFragmentWithMaxPromptTokens(
				8, // small budget
				<UserMessage>
					<TextChunk priority={1}>Lorem</TextChunk>
					<TextChunk priority={2}>Ipsum</TextChunk>
					<cacheCheckpoint type="ephemeral" />
					<TextChunk priority={3}>Dolor</TextChunk>
					<TextChunk priority={4}>Sit</TextChunk>
				</UserMessage>
			);
			// Only C/D may be pruned, A/B and checkpoint must remain
			assert.deepStrictEqual(res2.messages, [
				{
					role: Raw.ChatRole.User,
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Lorem\nIpsum' },
						{ type: Raw.ChatCompletionContentPartKind.CacheCheckpoint, cacheType: 'ephemeral' },
					],
				},
			]);
		});

		test('throws if message cannot be brought within budget after last checkpoint', async () => {
			let error: any = undefined;
			try {
				await renderFragmentWithMaxPromptTokens(
					1, // too small for even content before checkpoint
					<UserMessage>
						<TextChunk priority={1}>A</TextChunk>
						<TextChunk priority={2}>B</TextChunk>
						<cacheCheckpoint type="ephemeral" />
						<TextChunk priority={3}>C</TextChunk>
					</UserMessage>
				);
			} catch (e) {
				error = e;
			}
			assert.ok(error, 'Expected error to be thrown');
			assert.match(String(error), /No lowest priority node found/);
		});
	});
});
