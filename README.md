# Prompt Builder

Declare prompts using TSX in VS Code extensions for Copilot Chat.

## Usage

This library exports a `renderPrompt` utility for rendering a TSX component to `vscode.LanguageModelChatMessage`s.

Here is an example of how your extension can use `renderPrompt` to render a TSX prompt in a Copilot chat participant that suggests SQL queries based on database context:
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
    const { messages } = await renderPrompt(
      TestPrompt,
      { userQuery: request.prompt },
      { modelMaxPromptTokens: 4096 }
    );
    const chatRequest = await vscode.lm.sendChatRequest(
      "copilot-gpt-4",
      messages,
      {},
      token
    );

    let data = "";
    for await (const part of chatRequest.stream) {
      data += part;
      response.markdown(part);
    }

    const regex = /```([^\n])*\n([\s\S]*?)\n?```/g;
    const match = regex.exec(data);
    const query = match ? match[2] : "";
    if (query) {
      response.button({
        title: "Run Query",
        command: "vscode-mssql-chat.runQuery",
        arguments: [query],
      });
    }

    return {};
  }
);
```

Here is an example of how you would declare the TSX prompt rendered above:

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
- Prompt elements can return other prompt elements which will all be rendered by the prompt renderer. Your prompt should use the following utility components:
  - `SystemMessage`, `UserMessage` and `AssistantMessage`: Text within these components will be converted to the system, user and assistant message types from the OpenAI API.
  - `SafetyRules`: This should usually be included in a `SystemMessage` to ensure that your feature is compliant with Responsible AI guidelines.
- If your prompt does asynchronous work e.g. VS Code extension API calls or additional requests to the Copilot API for chunk reranking, you can precompute this state in an optional async `prepare` method. `prepare` is called before `render` and the prepared state will be passed back to your prompt component's sync `render` method.
- Newlines are not preserved in string literals when rendered, and must be explicitly declared with the builtin `<br />` attribute.
- For now, if two prompt messages _with the same priority_ are up for eviction due to exceeding the token budget, it is not possible for a subtree of the prompt message declared before to evict a subtree of the prompt message declared later.

## Why TSX?

- Enable dynamic composition of OpenAI API request messages with respect to the token budget.
  - Prompts are ultimately bare strings, which makes them hard to edit once they are composed via string concatenation. Instead, with TSX prompting, messages are represented as a tree of TSX components. Each node in the tree has a `priority` that is conceptually similar to a `zIndex` (higher number == higher priority). If an intent declares more messages than can fit into the token budget, the prompt renderer prunes messages with the lowest priority from the `ChatMessage`s result, preserving the order in which they were declared.
  - This also makes it easier to support more sophisticated prompt management techniques, e.g. experimenting on variants of a prompt, or that a prompt part makes itself smaller with a Copilot API request to recursively summarize its children.
- Make prompt crafting transparent to the owner of each LLM-based feature/intent while still enabling reuse of common prompt elements like safety rules.
  - Your feature owns and fully controls the `System`, `User` and `Assistant` messages that are sent to the Copilot API. This allows greater control and visibility into the safety rules, prompt context kinds, and conversation history that are sent for each feature.
