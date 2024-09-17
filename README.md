# Prompt Builder

This library enables you to declare prompts using TSX when you develop VS Code extensions that integrate with Copilot Chat. To learn more, check out our [documentation](https://code.visualstudio.com/api/extension-guides/chat) or fork our quickstart [sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample).

## Why TSX?

As AI engineers, our products communicate with large language models using chat messages composed of text prompts. While developing Copilot Chat, we've found that composing prompts with just bare strings is unwieldy and frustrating.

Some of the challenges we ran into include:
1. We used either programmatic string concatenation or template strings for composing prompts. Programmatic string concatenation made prompt text increasingly difficult to read, maintain, and update over time. Template string-based prompts were rigid and prone to issues like unnecessary whitespace.
2. In both cases, our prompts and RAG-generated context could not adapt to changing context window constraints as we upgraded our models. Prompts are ultimately bare strings, which makes them hard to edit once they are composed via string concatenation.

To improve the developer experience for writing prompts in language model-based VS Code extensions like Copilot Chat, we built the TSX-based prompt renderer that we've extracted in this library. This has enabled us to compose expressive, flexible prompts that cleanly convert to chat messages. Our prompts are now able to evolve with our product and dynamically adapt to each model's context window.

### Key concepts

In this library, prompts are represented as a tree of TSX components that are flattened into a list of chat messages. Each TSX node in the tree has a `priority` that is conceptually similar to a `zIndex` (higher number == higher priority).

If a rendered prompt has more message tokens than can fit into the available context window, the prompt renderer prunes messages with the lowest priority from the `ChatMessage`s result, preserving the order in which they were declared. This means your extension code can safely declare TSX components for potentially large pieces of context like conversation history and codebase context.

TSX components at the root level must render to `ChatMessage`s at the root level. `ChatMessage`s may have TSX components as children, but they must ultimately render to text. You can also have `TextChunk`s within `ChatMessage`s, which allows you to reduce less important parts of a chat message under context window limits without losing the full message.

## Usage

### Workspace Setup

You can install this library in your extension using the command

```
npm install --save @vscode/prompt-tsx
```

This library exports a `renderPrompt` utility for rendering a TSX component to `vscode.LanguageModelChatMessage`s.

To enable TSX use in your extension, add the following configuration options to your `tsconfig.json`:
```json
{
	"compilerOptions": {
    // ...
    "jsx": "react",
    "jsxFactory": "vscpp",
    "jsxFragmentFactory": "vscppf"
  }
  // ...
}
```

Note: if your codebase depends on both `@vscode/prompt-tsx` and another library that uses JSX, for example in a monorepo where a parent folder has dependencies on React, you may encounter compilation errors when trying to add this library to your project. This is because [by default](https://www.typescriptlang.org/tsconfig/#types%5D), TypeScript includes all `@types` packages during compilation. You can address this by explicitly listing the types that you want considered during compilation, e.g.:
```json
{
  "compilerOptions": {
    "types": ["node", "jest", "express"]
  }
}
```

### Rendering a Prompt

Next, your extension can use `renderPrompt` to render a TSX prompt. Here is an example of using TSX prompts in a Copilot chat participant that suggests SQL queries based on database context:
```ts
import { renderPrompt } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { TestPrompt } from './prompt';

const participant = vscode.chat.createChatParticipant(
  "mssql",
  async (
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ) => {
    response.progress("Reading database context...");

    const models = await vscode.lm.selectChatModels({ family: 'gpt-4' });
    if (models.length === 0) {
      // No models available, return early
      return;
    }
    const chatModel = models[0];

    // Render TSX prompt
    const { messages } = await renderPrompt(
      TestPrompt,
      { userQuery: request.prompt },
      { modelMaxPromptTokens: 4096 },
      chatModel
    );

    const chatRequest = await chatModel.sendChatRequest(
      messages,
      {},
      token
    );

    // ... Report stream data to VS Code UI
  }
);
```

Here is how you would declare the TSX prompt rendered above:

```tsx
import { BasePromptElementProps, PromptElement, PromptSizing, AssistantMessage, UserMessage } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';

export interface PromptProps extends BasePromptElementProps {
    userQuery: string;
}

export interface PromptState {
    creationScript: string;
}

export class TestPrompt extends PromptElement<PromptProps, PromptState> {
    override async prepare() {
      }

    async render(state: PromptState, sizing: PromptSizing) {
        const sqlExtensionApi = await vscode.extensions.getExtension('ms-mssql.mssql')?.activate();
        const creationScript = await sqlExtensionApi.getDatabaseCreateScript?.();

        return (
            <>
                <AssistantMessage>
                    You are a SQL expert.<br />
                    Your task is to help the user craft SQL queries that perform their task.<br />
                    You should suggest SQL queries that are performant and correct.<br />
                    Return your suggested SQL query in a Markdown code block that begins with ```sql and ends with ```.<br />
                </AssistantMessage>
                <UserMessage>
                    Here are the creation scripts that were used to create the tables in my database. Pay close attention to the tables and columns that are available in my database:<br />
                    {state.creationScript}<br />
                    {this.props.userQuery}
                </UserMessage>
            </>
        );
    }
}

```

Please note:
- If your prompt does asynchronous work e.g. VS Code extension API calls or additional requests to the Copilot API for chunk reranking, you can precompute this state in an optional async `prepare` method. `prepare` is called before `render` and the prepared state will be passed back to your prompt component's sync `render` method.
- Newlines are not preserved in JSX text or between JSX elements when rendered, and must be explicitly declared with the builtin `<br />` attribute.
- For now, if two prompt messages _with the same priority_ are up for pruning due to exceeding the token budget, it is not possible for a subtree of the prompt message declared before to prune a subtree of the prompt message declared later.

### Managing your budget

If a rendered prompt has more message tokens than can fit into the available context window, the prompt renderer prunes messages with the lowest priority from the `ChatMessage`s result, preserving the order in which they were declared.

In the above example, each message had the same priority, so they would be pruned in the order in which they were declared, but we could control that by passing a priority to element:

```jsx
<>
  <AssistantMessage priority={300}>You are a SQL expert...</AssistantMessage>
  <UserMessage priority={200}>Here are the creation scripts that were used to create the tables in my database...</UserMessage>
  <UserMessage priority={100}>{this.props.userQuery}</UserMessage>
</>
```

In this case, a very long `userQuery` would get pruned from the output first if it's too long.

But, this is not ideal. Instead, we'd prefer to include as much of the query as possible. To do this, we can use the `flexGrow` property, which allows an element to use the remainder of its parent's token budget when it's rendered.

`prompt-tsx` provides a utility component that supports this use case: `TextChunk`. Given input text, and optionally a delimiting string or regular expression, it'll include as much of the text as possible to fit within its budget:

```tsx
<>
  <AssistantMessage priority={300}>You are a SQL expert...</AssistantMessage>
  <UserMessage priority={200}>Here are the creation scripts that were used to create the tables in my database...</UserMessage>
  <UserMessage priority={100}><TextChunk breakOn=' '>{this.props.userQuery}</TextChunk></UserMessage>
</>
```

When `flexGrow` is set for an element, other elements are rendered first, and then the `flexGrow` element is rendered and given the remaining unused token budget from its container as a parameter in the `PromptSizing` passed to its `prepare` and `render` methods. Here's a simplified version of the `TextChunk` component:

```tsx
class SimpleTextChunk extends PromptElement<{ text: string }, string> {
	prepare(sizing: PromptSizing): Promise<string> {
    const words = text.split(' ');
    let str = '';

    for (const word of words) {
      if (tokenizer.tokenLength(str + ' ' + word) > sizing.tokenBudget) {
        break
      }

      str += ' ' + word;
    }

		return str;
	}

	render(content: string) {
		return <>{content}</>;
	}
}
```

There are a few similar properties which control budget allocation you mind find useful for more advanced cases:

- `flexReserve`: controls the number of tokens reserved from the container's budget _before_ this element gets rendered. For example, if you have a 100 token budget and the elements `<><Foo /><Bar flexGrow={1} flexBasis={30}></>`, then `Foo` would receive a `PromptSizing.tokenBudget` of 70, and `Bar` would receive however many tokens of the 100 that `Foo` didn't use. This is only useful in conjunction with `flexGrow`.
- `flexBasis`: controls the proportion of tokens allocated from the container's budget to this element. It defaults to `1` on all elements. For example, if you have the elements `<><Foo /><Bar /></>` and a 100 token budget, each element would be allocated 50 tokens in its `PromptSizing.tokenBudget`. If you instead render `<><Foo /><Bar flexBasis={2} /></>`, `Bar` would receive 66 tokens and `Foo` would receive 33.

It's important to note that all of the `flex*` properties allow for cooperative use of the token budget for a prompt, but have no effect on the prioritization and pruning logic undertaken once all elements are rendered.

#### Debugging Budgeting

You can set a `tracer` property on the `PromptElement` to debug how your elements are rendered and how this library allocates your budget. We include a basic `HTMLTracer` you can use:

```js
const renderer = new PromptRenderer(/* ... */);
const tracer = new HTMLTracer();
renderer.tracer = tracer;
renderer.render(/* ... */);

fs.writeFile('debug.html', tracer.toHTML());
```

### Usage in Tools

Visual Studio Code's API supports language models tools, sometimes called 'functions'. The tools API allows tools to return multiple content types of data to its consumers, and this library supports both returning rich prompt elements to tool callers, as well as using rich content returned from tools.

#### As a Tool

As a tool, you can use this library normally. However, to return data to the tool caller, you will want to use a special function `renderElementJSON` to serialize your elements to a plain, transferrable JSON object that can be used by a consumer if they also leverage prompt-tsx:

Note that when VS Code invokes your language model tool, the `options` may contain `tokenOptions` which you should pass through as the third argument to `renderElementJSON`:

```ts
// 1. Import prompt-tsx's well-known content type:
import { contentType } from '@vscode/prompt-tsx';

async function doToolInvocation(options: LanguageModelToolInvocationOptions): vscode.LanguageModelToolResult {
  return {
    // In constructing your response, render the tree as JSON.
    [contentType]: await renderElementJSON(MyElement, options.parameters, options.tokenOptions),
    toString: () => '...',
  };
}
```

#### As a Consumer

You may invoke the `vscode.lm.invokeTool` API however you see fit. If you know your token budget in advance, you should pass it to the tool when you call `invokeTool` via the `tokenOptions` option. You can then render the result using the `<ToolResult />` helper element, for example:

```tsx
class MyElement extends PromptElement {
	async render(_state: void, sizing: PromptSizing) {
		const result = await vscode.lm.invokeTool(toolId, {
			parameters: getToolParameters(),
			tokenOptions: {
				tokenBudget: sizing.tokenBudget,
				countTokens: (text, token) => sizing.countTokens(text, token),
			}
		});

		return <ToolResult data={result} priority={20} />;
	}
}
```

