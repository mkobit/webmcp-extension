# Support Agent Client Protocol (ACP) runtimes in companion server

### What are you trying to do?

The WebMCP extension lets developers test WebMCP tools that web pages expose on `document.modelContext`. Currently, the extension routes chat turns either to the browser built-in Prompt API or to remote model providers through the companion server. This approach requires developers to configure raw model API keys in environment files. It also prevents developers from using their existing local agent environments, such as Google Antigravity or OpenAI Codex. Connecting to local agent runtimes lets developers test WebMCP tools with their preferred agent environments and select available models or reasoning settings without managing raw API keys.

### What would you like to see?

Add support to the companion server for local agent runtimes that implement the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/), with a bridge to expose active tab WebMCP tools through the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

Both specifications serve distinct roles in this workflow:
- **Agent Client Protocol (ACP)**: Connects the companion server to local agent runtimes across standard transport options, such as stdio child processes, local sockets, or network bridges. When the agent runtime supports configuration discovery, the companion server can query available models and reasoning effort levels without requiring raw API keys.
- **Model Context Protocol (MCP)**: Bridges tools from `document.modelContext` in the active browser tab to the agent. When an agent requests a tool call, the extension executes `document.modelContext.executeTool()` in the browser tab and returns the output to the agent.

### Security considerations

The primary security concern is protecting host system resources from untrusted web content. Local agent runtimes frequently have access to the local filesystem and terminal commands. When the companion server connects to an ACP runtime, it must restrict client capabilities to disable filesystem access and terminal execution.

Executing tool calls in the browser maintains the extension's existing guardrails. The extension side panel continues to manage user confirmation for non-read-only or consequential tools, spotlight untrusted content, and enforce character truncation limits before passing web page data back to the agent.
