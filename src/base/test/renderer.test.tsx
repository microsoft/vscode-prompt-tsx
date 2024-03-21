/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ChatRole } from '../openai';
import { PromptElement } from '../promptElement';
import {
	AssistantMessage,
	PrioritizedList,
	SystemMessage,
	TextChunk,
	UserMessage,
} from '../promptElements';
import { PromptRenderer, RenderPromptResult } from '../promptRenderer';
import { Cl100KBaseTokenizerImpl } from '../tokenizer/tokenizer';
import {
	BasePromptElementProps,
	IChatEndpointInfo,
	PromptElementCtor,
	PromptSizing,
} from '../types';

suite('PromptRenderer', async function () {
	const fakeEndpoint: any = {
		modelMaxPromptTokens: 8192,
	} satisfies Partial<IChatEndpointInfo>;
	const tokenizer = new Cl100KBaseTokenizerImpl();

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
		assert.deepStrictEqual(res.tokenCount, 129);
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
			assert.deepStrictEqual(res.tokenCount, 130);
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
			assert.deepStrictEqual(res.tokenCount, 130);
		});

		test('shaving one', async () => {
			const res = await renderWithMaxPromptTokens(129, Prompt1, {});
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
			assert.deepStrictEqual(res.tokenCount, 118);
		});

		test('shaving two', async () => {
			const res = await renderWithMaxPromptTokens(110, Prompt1, {});
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
			assert.deepStrictEqual(res.tokenCount, 102);
		});

		test('shaving a lot', async () => {
			const res = await renderWithMaxPromptTokens(54, Prompt1, {});
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
			assert.deepStrictEqual(res.tokenCount, 53);
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
						<SystemMessage flex={2}>
							<FooPromptElement flex={2} text={'Foo'} />
							<FooPromptElement flex={3} text={'Bar'} />
						</SystemMessage>
						<UserMessage flex={1}>
							<FooPromptElement text={'Foo'} />
						</UserMessage>
						<UserMessage flex={4}>
							<FooPromptElement text={'Foo'} />
						</UserMessage>
					</>
				);
			}
		}

		test('passes budget to children based on declared flex', async () => {
			const fakeEndpoint: any = {
				modelMaxPromptTokens: 100, // Total allowed tokens
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
					modelMaxPromptTokens: 8192,
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
				assert.deepStrictEqual(res1.tokenCount, 165);
			});

			test('are prioritized and fit within token budget', async () => {
				// Render with smaller token budget and ensure that messages are reduced in size
				const smallTokenBudgetEndpoint: any = {
					modelMaxPromptTokens: 140,
				} satisfies Partial<IChatEndpointInfo>;
				const inst2 = new PromptRenderer(
					smallTokenBudgetEndpoint,
					PromptWithChunks,
					{},
					tokenizer
				);
				const res2 = await inst2.render(undefined, undefined);
				assert.equal(res2.tokenCount, 120);
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
								<SystemMessage flex={1} priority={2001}>
									<TextChunk>
										00 01 02 03 04 05 06 07 08 09
										<br />
										10 11 12 13 14 15 16 17 18 19
										<br />
									</TextChunk>
								</SystemMessage>
								<UserMessage flex={1} priority={1000}>
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
								<UserMessage flex={1} priority={2000}>
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
					modelMaxPromptTokens: 150,
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
					modelMaxPromptTokens: 150,
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
});
