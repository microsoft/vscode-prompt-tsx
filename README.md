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

This library exports a `renderPrompt` utility for rendering a TSX component to `vscode.LanguageModelChatMessage`s.

To enable TSX use in your extension, add the following configuration options to your `tsconfig.json`:
```json
{
  "jsx": "react",
  "jsxFactory": "vscpp",
  "jsxFragmentFactory": "vscppf"
}
```

Next, your extension can use `renderPrompt` to render a TSX prompt. Here is an example of using TSX prompts in a Copilot chat participant that suggests SQL queries based on database context:
```ts
import { renderPrompt, Cl100KBaseTokenizer } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { TestPrompt } from './prompt';

const tokenizer = new Cl100KBaseTokenizer();
const participant = vscode.chat.createChatParticipant(
  "mssql",
  async (
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ) => {
    response.progress("Reading database context...");

    // Render TSX prompt
    const { messages } = await renderPrompt(
      TestPrompt,
      { userQuery: request.prompt },
      { modelMaxPromptTokens: 4096 },
      tokenizer
    );
    const chatRequest = await vscode.lm.sendChatRequest(
      "copilot-gpt-4",
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
import { BasePromptElementProps, PromptElement, PromptSizing, SystemMessage, UserMessage } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';

export interface PromptProps extends BasePromptElementProps {
    userQuery: string;
}

export interface PromptState {
    creationScript: string;
}

export class TestPrompt extends PromptElement<PromptProps, PromptState> {
    override async prepare() {
        const sqlExtensionApi = await vscode.extensions.getExtension('ms-mssql.mssql')?.activate();
        return { creationScript: await sqlExtensionApi.getDatabaseCreateScript?.() };
    }

    render(state: PromptState, sizing: PromptSizing) {
        return (
            <>
                <SystemMessage>
                    You are a SQL expert.<br />
                    Your task is to help the user craft SQL queries that perform their task.<br />
                    You should suggest SQL queries that are performant and correct.<br />
                    Return your suggested SQL query in a Markdown code block that begins with ```sql and ends with ```.<br />
                </SystemMessage>
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
- Newlines are not preserved in string literals when rendered, and must be explicitly declared with the builtin `<br />` attribute.
- For now, if two prompt messages _with the same priority_ are up for eviction due to exceeding the token budget, it is not possible for a subtree of the prompt message declared before to evict a subtree of the prompt message declared later.

### Building your extension with `@vscode/prompt-tsx`

You'll also want to vendor the `cl100k_base.tiktoken` file that ships with this library when you build and publish your VS Code extension. You can either do this with a `postinstall` script or, if you use `webpack`, a plugin like `CopyWebpackPlugin`:

```js
// in webpack.config.js
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'node_modules/@vscode/prompt-tsx/dist/base/tokenizer/cl100k_base.tiktoken' }
      ]
    })
  ],
```
