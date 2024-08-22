/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { BaseTokensPerCompletion, ChatMessage, ChatRole } from '../openai';
import { PromptElement } from '../promptElement';
import {
	AssistantMessage,
	PrioritizedList,
	SystemMessage,
	TextChunk,
	UserMessage,
} from '../promptElements';
import { PromptRenderer, RenderPromptResult } from '../promptRenderer';
import { PromptReference } from '../results';
import { Cl100KBaseTokenizer } from '../tokenizer/cl100kBaseTokenizer';
import { ITokenizer } from '../tokenizer/tokenizer';
import {
	BasePromptElementProps,
	IChatEndpointInfo,
	PromptElementCtor,
	PromptPiece,
	PromptSizing
} from '../types';

suite('PromptRenderer', () => {
	const fakeEndpoint: any = {
		modelMaxPromptTokens: 8192 - BaseTokensPerCompletion,
	} satisfies Partial<IChatEndpointInfo>;
	const tokenizer = new Cl100KBaseTokenizer();

	test('token counting', async () => {
		class Prompt1 extends PromptElement {
			render() {
				return (
					<>
						<SystemMessage>
							You are a helpful, pattern-following assistant that
							translates corporate jargon into plain English.
						</SystemMessage>
						<SystemMessage name="example_user">
							New synergies will help drive top-line growth.
						</SystemMessage>
						<SystemMessage name="example_assistant">
							Things working well together will increase revenue.
						</SystemMessage>
						<SystemMessage name="example_user">
							Let's circle back when we have more bandwidth to
							touch base on opportunities for increased leverage.
						</SystemMessage>
						<SystemMessage name="example_assistant">
							Let's talk later when we're less busy about how to
							do better.
						</SystemMessage>
						<UserMessage>
							This late pivot means we don't have time to boil the
							ocean for the client deliverable.
						</UserMessage>
					</>
				);
			}
		}

		const inst = new PromptRenderer(fakeEndpoint, Prompt1, {}, tokenizer);
		const res = await inst.render(undefined, undefined);
		assert.deepStrictEqual(res.messages, [
			{
				role: 'system',
				content:
					'You are a helpful, pattern-following assistant that translates corporate jargon into plain English.',
			},
			{
				role: 'system',
				name: 'example_user',
				content: 'New synergies will help drive top-line growth.',
			},
			{
				role: 'system',
				name: 'example_assistant',
				content: 'Things working well together will increase revenue.',
			},
			{
				role: 'system',
				name: 'example_user',
				content:
					"Let's circle back when we have more bandwidth to touch base on opportunities for increased leverage.",
			},
			{
				role: 'system',
				name: 'example_assistant',
				content:
					"Let's talk later when we're less busy about how to do better.",
			},
			{
				role: 'user',
				content:
					"This late pivot means we don't have time to boil the ocean for the client deliverable.",
			},
		]);
		assert.deepStrictEqual(res.tokenCount, 129 - BaseTokensPerCompletion);
	});

	test('runs async prepare in parallel', async () => {
		class Prompt3 extends PromptElement<
			{ timeout: number; index: number } & BasePromptElementProps
		> {
			override async prepare() {
				await new Promise((resolve) =>
					setTimeout(resolve, this.props.timeout)
				);
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
			const inst1 = new PromptRenderer(
				fakeEndpoint,
				Prompt3,
				promptElement.props,
				tokenizer
			);
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
				role: 'user',
				content: 'Hello 1!',
			},
			{
				role: 'user',
				content: 'Hello 2!',
			},
			{
				role: 'user',
				content: 'Hello 3!',
			},
		]);
	});

	test('maintains element order', async () => {
		class Prompt2 extends PromptElement<{ content: string } & BasePromptElementProps> {
			render() {
				return (
					<TextChunk>{this.props.content}</TextChunk>
				);
			}
		}

		class Prompt1 extends PromptElement {
			render() {
				return (
					<>
						<SystemMessage>
							a
							<Prompt2 content='b' />
							c
							<TextChunk>d</TextChunk>
							e
							<TextChunk flexGrow={2}>f</TextChunk>
							g
							<Prompt2 content='h' flexGrow={1} />
							i
						</SystemMessage>
					</>
				);
			}
		}

		const inst = new PromptRenderer(fakeEndpoint, Prompt1, {}, tokenizer);
		const res = await inst.render(undefined, undefined);
		assert.deepStrictEqual(res.messages.length, 1);
		assert.deepStrictEqual(res.messages[0].content.replace(/\n/g, ''), 'abcdefghi');
	});

	test('renders tool calls', async () => {
		class Prompt1 extends PromptElement {
			render() {
				return (
					<>
						<AssistantMessage tool_calls={[{ id: 'call_123', type: 'function', function: { name: 'tool1', arguments: '' } }]}>assistant</AssistantMessage>
						<UserMessage>hello</UserMessage>
					</>
				);
			}
		}

		const inst = new PromptRenderer(fakeEndpoint, Prompt1, {}, tokenizer);
		const res = await inst.render(undefined, undefined);
		assert.deepStrictEqual(res.messages.length, 2);
		assert.deepStrictEqual(res.messages[0].content.replace(/\n/g, ''), 'abcdefghi');
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
						<UserMessage priority={499}>
							Hello, how are you?
						</UserMessage>
						<AssistantMessage priority={500}>
							I am terrific, how are you?
						</AssistantMessage>
						<UserMessage priority={900}>
							What time is it?
						</UserMessage>
					</>
				);
			}
		}

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
			const inst = new PromptRenderer(
				fakeEndpoint,
				Prompt1,
				{},
				tokenizer
			);
			return await inst.render(undefined, undefined);
		}

		test('no shaving', async () => {
			const res = await renderWithMaxPromptTokens(8192, Prompt1, {});
			assert.deepStrictEqual(res.messages, [
				{
					role: 'system',
					content:
						'You are a helpful assistant that cheers people up.',
				},
				{
					role: 'system',
					name: 'example_user',
					content: 'How are you?',
				},
				{
					role: 'system',
					name: 'example_assistant',
					content: 'I am fantastic. How are you?',
				},
				{
					role: 'system',
					name: 'example_user',
					content: 'What time is it?',
				},
				{
					role: 'system',
					name: 'example_assistant',
					content: "It's high time to be happy!",
				},
				{
					role: 'system',
					name: 'example_user',
					content: 'What is your name?',
				},
				{
					role: 'system',
					name: 'example_assistant',
					content: 'My name is Happy Copilot.',
				},
				{ role: 'user', content: 'Hello, how are you?' },
				{ role: 'assistant', content: 'I am terrific, how are you?' },
				{ role: 'user', content: 'What time is it?' },
			]);
			assert.deepStrictEqual(res.tokenCount, 130 - BaseTokensPerCompletion);
		});

		test('no shaving at limit', async () => {
			const res = await renderWithMaxPromptTokens(130, Prompt1, {});
			assert.deepStrictEqual(res.messages, [
				{
					role: 'system',
					content:
						'You are a helpful assistant that cheers people up.',
				},
				{
					role: 'system',
					name: 'example_user',
					content: 'How are you?',
				},
				{
					role: 'system',
					name: 'example_assistant',
					content: 'I am fantastic. How are you?',
				},
				{
					role: 'system',
					name: 'example_user',
					content: 'What time is it?',
				},
				{
					role: 'system',
					name: 'example_assistant',
					content: "It's high time to be happy!",
				},
				{
					role: 'system',
					name: 'example_user',
					content: 'What is your name?',
				},
				{
					role: 'system',
					name: 'example_assistant',
					content: 'My name is Happy Copilot.',
				},
				{ role: 'user', content: 'Hello, how are you?' },
				{ role: 'assistant', content: 'I am terrific, how are you?' },
				{ role: 'user', content: 'What time is it?' },
			]);
			assert.deepStrictEqual(res.tokenCount, 130 - BaseTokensPerCompletion);
		});

		test('shaving one', async () => {
			const res = await renderWithMaxPromptTokens(129 - BaseTokensPerCompletion, Prompt1, {});
			assert.deepStrictEqual(res.messages, [
				{
					role: 'system',
					content:
						'You are a helpful assistant that cheers people up.',
				},
				{
					role: 'system',
					name: 'example_user',
					content: 'How are you?',
				},
				{
					role: 'system',
					name: 'example_assistant',
					content: 'I am fantastic. How are you?',
				},
				{
					role: 'system',
					name: 'example_assistant',
					content: "It's high time to be happy!",
				},
				{
					role: 'system',
					name: 'example_user',
					content: 'What is your name?',
				},
				{
					role: 'system',
					name: 'example_assistant',
					content: 'My name is Happy Copilot.',
				},
				{ role: 'user', content: 'Hello, how are you?' },
				{ role: 'assistant', content: 'I am terrific, how are you?' },
				{ role: 'user', content: 'What time is it?' },
			]);
			assert.deepStrictEqual(res.tokenCount, 118 - BaseTokensPerCompletion);
		});

		test('shaving two', async () => {
			const res = await renderWithMaxPromptTokens(110 - BaseTokensPerCompletion, Prompt1, {});
			assert.deepStrictEqual(res.messages, [
				{
					role: 'system',
					content:
						'You are a helpful assistant that cheers people up.',
				},
				{
					role: 'system',
					name: 'example_user',
					content: 'How are you?',
				},
				{
					role: 'system',
					name: 'example_assistant',
					content: 'I am fantastic. How are you?',
				},
				{
					role: 'system',
					name: 'example_user',
					content: 'What is your name?',
				},
				{
					role: 'system',
					name: 'example_assistant',
					content: 'My name is Happy Copilot.',
				},
				{ role: 'user', content: 'Hello, how are you?' },
				{ role: 'assistant', content: 'I am terrific, how are you?' },
				{ role: 'user', content: 'What time is it?' },
			]);
			assert.deepStrictEqual(res.tokenCount, 102 - BaseTokensPerCompletion);
		});

		test('shaving a lot', async () => {
			const res = await renderWithMaxPromptTokens(54 - BaseTokensPerCompletion, Prompt1, {});
			assert.deepStrictEqual(res.messages, [
				{
					role: 'system',
					content:
						'You are a helpful assistant that cheers people up.',
				},
				{
					role: 'system',
					name: 'example_user',
					content: 'How are you?',
				},
				{
					role: 'system',
					name: 'example_assistant',
					content: 'I am fantastic. How are you?',
				},
				{ role: 'user', content: 'What time is it?' },
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
			const inst = new PromptRenderer(
				fakeEndpoint,
				FlexPrompt,
				{},
				tokenizer
			);
			const res = await inst.render(undefined, undefined);

			// Ensure that the prompt received budget based on the flex
			assert.ok(
				res.messages[0].content.length > res.messages[1].content.length
			);
			assert.ok(
				res.messages[2].content.length > res.messages[0].content.length
			);

			// Ensure that children received budget based on the parent budget
			const firstMessageContent = res.messages[0].content;
			const barPartStart = firstMessageContent.indexOf('Bar');
			const fooPart = firstMessageContent.slice(0, barPartStart);
			const barPart = firstMessageContent.slice(barPartStart);
			assert.ok(fooPart.length > 0);
			assert.ok(barPart.length > 0);
			assert.ok(fooPart.length < barPart.length);
		});
	});

	suite(
		'supports prioritizing and shaving chunks within a message',
		function () {
			class PromptWithChunks extends PromptElement {
				render() {
					return (
						<>
							<SystemMessage>
								<TextChunk priority={21}>
									You are a helpful assistant that cheers
									people up.
								</TextChunk>
								<TextChunk priority={20}>
									Here are some examples of how you should
									respond to the user:
								</TextChunk>
								{/* TextChunks can be used to express multiline fragments within a ChatMessage with variable priority levels. */}
								<TextChunk priority={12}>
									Example 1:
									<br />
									User: "I have a list of numbers, how do I
									sum them?"
									<br />
									Assistant: "You can use the reduce
									function."
								</TextChunk>
								<TextChunk priority={11}>
									Example 2:
									<br />
									User: "What is the airspeed velocity of an
									unladen swallow?"
									<br />
									Assistant: "Sorry, I can't assist with
									that."
								</TextChunk>
								<TextChunk priority={10}>
									Example 3:
									<br />
									User: "What is the difference between map
									and forEach?"
									<br />
									Assistant: "The map function returns a new
									array, the forEach function does not."
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
							<UserMessage priority={31}>
								What is your name?
							</UserMessage>
						</>
					);
				}
			}

			test('are rendered to chat messages', async () => {
				// First render with large token budget so nothing gets dropped
				const largeTokenBudgetEndpoint: any = {
					modelMaxPromptTokens: 8192 - BaseTokensPerCompletion,
				} satisfies Partial<IChatEndpointInfo>;
				const inst1 = new PromptRenderer(
					largeTokenBudgetEndpoint,
					PromptWithChunks,
					{},
					tokenizer
				);
				const res1 = await inst1.render(undefined, undefined);
				assert.deepStrictEqual(res1.messages, [
					{
						role: 'system',
						content: [
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
					{
						role: 'user',
						content: [
							'Here are some relevant code snippets:',
							'```ts',
							'console.log(42)',
							'```',
							'```ts',
							'console.log("Don\'t Panic")',
							'```',
						].join('\n'),
					},
					{ role: 'user', content: 'What is your name?' },
				]);
				assert.deepStrictEqual(res1.tokenCount, 165 - BaseTokensPerCompletion);
			});

			test('are prioritized and fit within token budget', async () => {
				// Render with smaller token budget and ensure that messages are reduced in size
				const smallTokenBudgetEndpoint: any = {
					modelMaxPromptTokens: 140 - BaseTokensPerCompletion,
				} satisfies Partial<IChatEndpointInfo>;
				const inst2 = new PromptRenderer(
					smallTokenBudgetEndpoint,
					PromptWithChunks,
					{},
					tokenizer
				);
				const res2 = await inst2.render(undefined, undefined);
				assert.equal(res2.tokenCount, 120 - BaseTokensPerCompletion);
				assert.deepStrictEqual(res2.messages, [
					{
						role: 'system',
						content: [
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
					{
						role: 'user',
						content: [
							'Here are some relevant code snippets:',
							'```ts',
							'console.log(42)',
							'```',
						].join('\n'),
					},
					{ role: 'user', content: 'What is your name?' },
				]);
			});

			test('are globally prioritized across messages', async () => {
				class TextChunkPrompt extends PromptElement {
					render() {
						return (
							<>
								<SystemMessage flexBasis={1} priority={2001}>
									<TextChunk>
										00 01 02 03 04 05 06 07 08 09
										<br />
										10 11 12 13 14 15 16 17 18 19
										<br />
									</TextChunk>
								</SystemMessage>
								<UserMessage flexBasis={1} priority={1000}>
									<TextChunk priority={1000}>
										HI HI 00 01 02 03 04 05 06 07 08 09
										<br />
										10 11 12 13 14 15 16 17 18 19
										<br />
									</TextChunk>
									<TextChunk priority={500}>
										HI MED 00 01 02 03 04 05 06 07 08 09
										<br />
										10 11 12 13 14 15 16 17 18 19
										<br />
									</TextChunk>
									<TextChunk priority={100}>
										HI LOW 00 01 02 03 04 05 06 07 08 09
										<br />
										10 11 12 13 14 15 16 17 18 19
										<br />
									</TextChunk>
								</UserMessage>
								<UserMessage flexBasis={1} priority={2000}>
									<TextChunk priority={2000}>
										LOW HI 00 01 02 03 04 05 06 07 08 09
										<br />
										10 11 12 13 14 15 16 17 18 19
										<br />
									</TextChunk>
									<TextChunk priority={2000}>
										LOW MED 00 01 02 03 04 05 06 07 08 09
										<br />
										10 11 12 13 14 15 16 17 18 19
										<br />
									</TextChunk>
									<TextChunk priority={2000}>
										LOW LOW 00 01 02 03 04 05 06 07 08 09
										<br />
										10 11 12 13 14 15 16 17 18 19
										<br />
									</TextChunk>
								</UserMessage>
							</>
						);
					}
				}

				const smallTokenBudgetEndpoint: any = {
					modelMaxPromptTokens: 150 - BaseTokensPerCompletion,
				} satisfies Partial<IChatEndpointInfo>;
				const inst2 = new PromptRenderer(
					smallTokenBudgetEndpoint,
					TextChunkPrompt,
					{},
					tokenizer
				);
				const res2 = await inst2.render(undefined, undefined);
				assert.equal(res2.messages.length, 2);
				assert.equal(res2.messages[0].role, ChatRole.System);
				assert.equal(res2.messages[1].role, ChatRole.User);
				assert.equal(
					res2.messages[1].content,
					`LOW HI 00 01 02 03 04 05 06 07 08 09
10 11 12 13 14 15 16 17 18 19

LOW MED 00 01 02 03 04 05 06 07 08 09
10 11 12 13 14 15 16 17 18 19
`
				);
			});

			test('are prioritized within prioritized lists', async () => {
				class PriorityListPrompt extends PromptElement {
					render() {
						const textChunksA = [];
						for (let i = 0; i < 100; i++) {
							textChunksA.push(
								<TextChunk>
									{i.toString().padStart(3, '0')}
								</TextChunk>
							);
						}

						const textChunksB = [];
						for (let i = 100; i < 200; i++) {
							textChunksB.push(
								<TextChunk>
									{i.toString().padStart(3, '0')}
								</TextChunk>
							);
						}

						return (
							<>
								<SystemMessage>
									Hello there, this is a system message.
								</SystemMessage>
								<UserMessage>
									<PrioritizedList
										priority={900}
										descending={false}
									>
										{...textChunksA}
									</PrioritizedList>
									<PrioritizedList
										priority={1001}
										descending={false}
									>
										{...textChunksB}
									</PrioritizedList>
								</UserMessage>
							</>
						);
					}
				}

				const smallTokenBudgetEndpoint: any = {
					modelMaxPromptTokens: 150 - BaseTokensPerCompletion,
				} satisfies Partial<IChatEndpointInfo>;
				const inst2 = new PromptRenderer(
					smallTokenBudgetEndpoint,
					PriorityListPrompt,
					{},
					tokenizer
				);
				const res2 = await inst2.render(undefined, undefined);
				assert.equal(res2.messages.length, 2);
				assert.equal(res2.messages[0].role, ChatRole.System);
				assert.equal(res2.messages[1].role, ChatRole.User);
				assert.ok(
					res2.messages[1].content.includes('199'),
					'Higher-priority chunks from second user message were not included'
				);
				assert.ok(
					!res2.messages[1].content.includes('099'),
					'Lower-priority chunks from first user message were included'
				);
				assert.ok(
					!res2.messages[1].content.includes('000'),
					'Lower-priority chunks from first user message were included'
				);
			});
		}
	);

	suite('tracks surviving prompt references', async () => {
		const variableReference = { variableName: 'foo' };
		class PromptWithReference extends PromptElement {
			render() {
				return (
					<>
						<UserMessage>
							<TextChunk>
								<references value={[new PromptReference(variableReference)]} />
								Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
							</TextChunk>
							<TextChunk>
								<references value={[new PromptReference(variableReference)]} />
								Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
							</TextChunk>
						</UserMessage>
						<UserMessage>
							Foo
						</UserMessage>
					</>
				);
			}
		}

		test('reports reference that survived prioritization', async () => {
			const endpoint: any = {
				modelMaxPromptTokens: 4096 - BaseTokensPerCompletion,
			} satisfies Partial<IChatEndpointInfo>;

			const inst = new PromptRenderer(
				endpoint,
				PromptWithReference,
				{},
				tokenizer
			);
			const res = await inst.render(undefined, undefined);
			assert.equal(res.messages.length, 2);
			assert.equal(res.references.length, 1);
			assert.equal(res.references[0].anchor, variableReference);
		});

		test('does not report reference that did not survive prioritization', async () => {
			const endpoint: any = {
				modelMaxPromptTokens: 10,
			} satisfies Partial<IChatEndpointInfo>;

			const inst = new PromptRenderer(
				endpoint,
				PromptWithReference,
				{},
				tokenizer
			);
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
								Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
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

			const inst = new PromptRenderer(
				endpoint,
				PromptWithReferences,
				{},
				tokenizer
			);
			const res = await inst.render(undefined, undefined);
			assert.equal(res.messages.length, 2);
			assert.equal(res.references.length, 2);
		});
	});

	suite('flex behavior', () => {
		const consumeRe = /consume=(\d+)/g;

		class FakeTokenizer implements ITokenizer {
			baseTokensPerMessage = 0;
			baseTokensPerName = 0;
			baseTokensPerCompletion = 0;

			tokenLength(text: string): number {
				let n = 0;
				for (const match of text.matchAll(consumeRe)) {
					n += Number(match[1]);
				}
				return n;
			}

			countMessageTokens(message: ChatMessage): number {
				return this.tokenLength(message.content);
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

		async function flexTest(elements: PromptPiece, expected: ChatMessage[]) {
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
			await flexTest(<>
				<EchoBudget name='content' useBudget={10} />
				<EchoBudget name='grow' flexGrow={1} />
			</>,
				[
					{
						content: 'consume=10, content=100',
						role: ChatRole.User,
					},
					{
						content: 'grow=90',
						role: ChatRole.User,
					}
				]
			);
		});

		test('applies flex reserve', async () => {
			await flexTest(<>
				<EchoBudget name='content' useBudget={10} />
				<EchoBudget name='grow' flexGrow={1} flexReserve={20} />
			</>,
				[
					{
						content: 'consume=10, content=80',
						role: ChatRole.User,
					},
					{
						content: 'grow=90',
						role: ChatRole.User,
					}
				]
			);
		});

		test('shared between multiple in flex groups', async () => {
			await flexTest(<>
				<EchoBudget name='content' useBudget={10} />
				<EchoBudget name='grow1' flexGrow={1} />
				<EchoBudget name='grow2' flexGrow={1} />
			</>,
				[
					{
						content: 'consume=10, content=100',
						role: ChatRole.User,
					},
					{
						content: 'grow1=45',
						role: ChatRole.User,
					},
					{
						content: 'grow2=45',
						role: ChatRole.User,
					}
				]
			);
		});

		test('counts budget used in nested elements', async () => {
			class Nested extends PromptElement {
				render() {
					return (
						<NestedB />
					);
				}
			}
			class NestedB extends PromptElement<BasePromptElementProps, number> {
				async prepare() {
					return Promise.resolve(42);
				}
				render(consume: number) {
					return (
						<SystemMessage>{`consume=${consume}`}</SystemMessage>
					);
				}
			}
			await flexTest(<>
				<Nested />
				<EchoBudget name='grow1' flexGrow={1} />
				<EchoBudget name='grow2' flexGrow={1} />
			</>,
				[
					{
						content: 'consume=42',
						role: ChatRole.System,
					},
					{
						content: 'grow1=29',
						role: ChatRole.User,
					},
					{
						content: 'grow2=29',
						role: ChatRole.User,
					}
				]
			);
		});

		test('all together now 🙌', async () => {
			await flexTest(<>
				<EchoBudget name='content1' useBudget={10} />
				<EchoBudget name='content2' useBudget={20} flexBasis={2} />
				<EchoBudget name='grow2a' flexGrow={2} flexReserve={20} useBudget={15} />
				<EchoBudget name='grow1a' flexGrow={1} flexReserve={10} />
				<EchoBudget name='grow1b' flexGrow={1} flexReserve={10} flexBasis={2} />
				<EchoBudget name='grow2b' flexGrow={2} flexReserve={20} useBudget={20} />
			</>,
				[
					{
						content: 'consume=10, content1=13', // non-flex elements have 40 unreserved budget, #2 uses flex=2 to get a bigger share
						role: ChatRole.User,
					},
					{
						content: 'consume=20, content2=26',
						role: ChatRole.User,
					},

					{
						content: 'consume=15, grow2a=25', // 70 budget left over, 20 reserved, shared between flexGrow=2
						role: ChatRole.User,
					},

					{
						content: 'grow1a=11', // 35 used, b asked for a larger share
						role: ChatRole.User,
					},
					{
						content: 'grow1b=23',
						role: ChatRole.User,
					},

					{
						content: 'consume=20, grow2b=25',
						role: ChatRole.User,
					},
				]
			);
		});
	})
});
