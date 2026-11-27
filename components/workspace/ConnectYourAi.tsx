"use client";

import { ExternalLink } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Path, Snippet, StepRow, Ui, Value } from "@/components/workspace/SetupSteps";
import {
  claudeCodeCommand,
  codexCommands,
  cursorConfig,
  cursorInstallLink,
  geminiCommand,
  genericConfig,
  vscodeCommand,
  vscodeInstallLink,
} from "@/lib/mcp/install-links";
import { cn } from "@/lib/utils";

/**
 * "Connect your AI" (docs/features/23-connect-your-ai.md): exact setup steps
 * for each AI app, so people use Kanso from the app they already pay for.
 * Menu names were checked against each vendor's docs in November 2026; each
 * tab links to the vendor's own help, so a renamed menu is a docs fix.
 */

const TRY_IT = "What’s assigned to me in Kanso?";
const STORAGE_KEY = "kanso.connect-ai.tab";

const APPS = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "claude-code", label: "Claude Code" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
  { id: "other", label: "Other" },
] as const;

type AppId = (typeof APPS)[number]["id"];

const isAppId = (value: string | null): value is AppId => APPS.some((app) => app.id === value);

// The last tab picked, per browser. When storage is unavailable (private
// mode) it lasts until the page reloads.
let chosenHere: AppId | null = null;
const listeners = new Set<() => void>();

function storedTab(): AppId {
  if (chosenHere) return chosenHere;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isAppId(value) ? value : "chatgpt";
  } catch {
    return "chatgpt";
  }
}

function storeTab(tab: AppId) {
  chosenHere = tab;
  try {
    localStorage.setItem(STORAGE_KEY, tab);
  } catch {
    // Kept in memory above.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function ConnectYourAi({ mcpUrl }: { mcpUrl: string }) {
  // The server render (and the first client render) shows ChatGPT.
  const tab = useSyncExternalStore(subscribe, storedTab, () => "chatgpt" as AppId);
  const choose = storeTab;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="connect-your-ai">
      <div>
        <h2 id="connect-your-ai" className="font-heading text-sm font-semibold text-foreground">
          Connect your AI
        </h2>
        <p className="text-sm text-muted-foreground">
          Use Kanso from the AI app you already pay for. It signs in as you and can do what you can do here, in
          every workspace you belong to.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="AI app"
        className="flex h-7 max-w-full items-center self-start overflow-x-auto rounded-md bg-chip p-0.5 [scrollbar-width:none]"
      >
        {APPS.map((app) => (
          <button
            key={app.id}
            id={`connect-tab-${app.id}`}
            type="button"
            role="tab"
            aria-selected={tab === app.id}
            aria-controls="connect-panel"
            onClick={() => choose(app.id)}
            className={cn(
              "flex h-6 shrink-0 items-center rounded-[5px] px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
              tab === app.id && "bg-seg text-foreground shadow-seg",
            )}
          >
            {app.label}
          </button>
        ))}
      </div>

      <div
        id="connect-panel"
        role="tabpanel"
        aria-labelledby={`connect-tab-${tab}`}
        className="flex flex-col gap-4 rounded-lg border bg-surface p-4 text-sm shadow-card"
      >
        <Guide app={tab} mcpUrl={mcpUrl} onChoose={choose} />
      </div>
    </section>
  );
}

function Guide({ app, mcpUrl, onChoose }: { app: AppId; mcpUrl: string; onChoose: (app: AppId) => void }) {
  switch (app) {
    case "chatgpt":
      return <ChatGptGuide mcpUrl={mcpUrl} onChoose={onChoose} />;
    case "claude":
      return <ClaudeGuide mcpUrl={mcpUrl} />;
    case "codex":
      return <CodexGuide mcpUrl={mcpUrl} />;
    case "claude-code":
      return <ClaudeCodeGuide mcpUrl={mcpUrl} />;
    case "gemini":
      return <GeminiGuide mcpUrl={mcpUrl} />;
    case "cursor":
      return <CursorGuide mcpUrl={mcpUrl} />;
    case "vscode":
      return <VsCodeGuide mcpUrl={mcpUrl} />;
    case "other":
      return <OtherGuide mcpUrl={mcpUrl} />;
  }
}

function ChatGptGuide({ mcpUrl, onChoose }: { mcpUrl: string; onChoose: (app: AppId) => void }) {
  return (
    <>
      <Steps>
        <StepRow number={1} title="Add a custom MCP server in ChatGPT">
          <Path items={["Plugins", "+", "Add custom MCP server"]} />
          <OpenButton href="https://chatgpt.com/plugins">Open ChatGPT</OpenButton>
        </StepRow>
        <StepRow number={2} title="Fill in the connection">
          <Snippet label="Name" text="Kanso" />
          <Snippet label="MCP server URL" text={mcpUrl} />
          <p className="text-muted-foreground">
            Authentication: <Value>OAuth</Value>
          </p>
        </StepRow>
        <StepRow number={3} title="Create it">
          <p className="text-muted-foreground">
            Tick <Ui>I understand and want to continue</Ui>, then <Ui>Create as a plugin</Ui>.
          </p>
        </StepRow>
        <StepRow number={4} title="Sign in to Kanso">
          <p className="text-muted-foreground">Sign in, then choose what ChatGPT may do: read, or read and write.</p>
        </StepRow>
        <TryIt number={5} how={<>Start a chat, type <Value>@Kanso</Value>, and ask:</>} />
      </Steps>
      <Note>
        <p>
          <span className="font-medium text-foreground">Which ChatGPT plans can do this.</span> Business and
          Enterprise/Edu: read and write (on Business, a workspace admin adds it). Pro: read only. Plus, Go and
          Free can’t add custom MCP servers yet.
        </p>
        <p>
          On ChatGPT Plus?{" "}
          <button type="button" className="font-medium text-primary-text underline-offset-2 hover:underline" onClick={() => onChoose("codex")}>
            Use Codex with your ChatGPT sign-in
          </button>{" "}
          instead, or ask your workspace admin about ChatGPT Business.
        </p>
      </Note>
      <Help href="https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt">
        ChatGPT’s help on custom MCP servers
      </Help>
    </>
  );
}

function ClaudeGuide({ mcpUrl }: { mcpUrl: string }) {
  return (
    <>
      <Steps>
        <StepRow number={1} title="Add a custom connector in Claude">
          <Path items={["Settings", "Connectors", "Add custom connector"]} />
          <OpenButton href="https://claude.ai/settings/connectors">Open Claude</OpenButton>
        </StepRow>
        <StepRow number={2} title="Fill in the connector">
          <Snippet label="Name" text="Kanso" />
          <Snippet label="Remote MCP server URL" text={mcpUrl} />
        </StepRow>
        <StepRow number={3} title="Connect and sign in to Kanso">
          <p className="text-muted-foreground">
            Click <Ui>Connect</Ui>, sign in, and choose what Claude may do. It works in Claude on the web, desktop and
            mobile.
          </p>
        </StepRow>
        <TryIt number={4} how="In a new chat, ask:" />
      </Steps>
      <Note>
        <p>On Team and Enterprise plans, an owner may need to add the connector for the organization first.</p>
      </Note>
    </>
  );
}

function CodexGuide({ mcpUrl }: { mcpUrl: string }) {
  const commands = codexCommands(mcpUrl);
  return (
    <>
      <Steps>
        <StepRow number={1} title="Add Kanso to Codex">
          <Snippet label="In a terminal" text={commands.add} />
        </StepRow>
        <StepRow number={2} title="Sign in to Kanso">
          <Snippet label="Opens your browser" text={commands.login} />
        </StepRow>
        <TryIt number={3} how="Start Codex and ask:" />
      </Steps>
      <Note>
        <p>
          Works with any ChatGPT plan that includes Codex, or an OpenAI API key. Prefer editing settings? Add this to{" "}
          <code className="font-mono text-xs">~/.codex/config.toml</code>, then run the sign-in command above:
        </p>
        <Snippet label="config.toml" text={commands.config} />
      </Note>
      <Help href="https://learn.chatgpt.com/docs/extend/mcp">Codex’s help on MCP servers</Help>
    </>
  );
}

function ClaudeCodeGuide({ mcpUrl }: { mcpUrl: string }) {
  return (
    <Steps>
      <StepRow number={1} title="Add Kanso to Claude Code">
        <Snippet label="In a terminal" text={claudeCodeCommand(mcpUrl)} />
      </StepRow>
      <StepRow number={2} title="Sign in to Kanso">
        <p className="text-muted-foreground">
          In Claude Code, run <Value>/mcp</Value>, pick <Value>kanso</Value>, and sign in.
        </p>
      </StepRow>
      <TryIt number={3} how="Then ask:" />
    </Steps>
  );
}

function GeminiGuide({ mcpUrl }: { mcpUrl: string }) {
  return (
    <>
      <Steps>
        <StepRow number={1} title="Add Kanso to Gemini CLI">
          <Snippet label="In a terminal" text={geminiCommand(mcpUrl)} />
        </StepRow>
        <StepRow number={2} title="Sign in to Kanso">
          <p className="text-muted-foreground">
            In Gemini CLI, run <Value>/mcp auth kanso</Value>. Your browser opens to sign in.
          </p>
        </StepRow>
        <TryIt number={3} how="Then ask:" />
      </Steps>
      <Help href="https://geminicli.com/docs/tools/mcp-server/">Gemini CLI’s help on MCP servers</Help>
    </>
  );
}

function CursorGuide({ mcpUrl }: { mcpUrl: string }) {
  return (
    <>
      <Steps>
        <StepRow number={1} title="Add Kanso to Cursor">
          <Button asChild size="sm" className="self-start">
            <a href={cursorInstallLink(mcpUrl)}>Add to Cursor</a>
          </Button>
          <p className="text-muted-foreground">
            Or add it to <code className="font-mono text-xs">~/.cursor/mcp.json</code> yourself:
          </p>
          <Snippet label="mcp.json" text={cursorConfig(mcpUrl)} />
        </StepRow>
        <StepRow number={2} title="Sign in to Kanso">
          <p className="text-muted-foreground">
            The first time Cursor connects, it asks you to sign in to Kanso. If it doesn’t, open Kanso in Cursor’s
            MCP settings and sign in from there.
          </p>
        </StepRow>
        <TryIt number={3} how="In the agent chat, ask:" />
      </Steps>
      <Help href="https://cursor.com/docs/mcp/install-links">Cursor’s help on MCP install links</Help>
    </>
  );
}

function VsCodeGuide({ mcpUrl }: { mcpUrl: string }) {
  return (
    <>
      <Steps>
        <StepRow number={1} title="Add Kanso to VS Code">
          <Button asChild size="sm" className="self-start">
            <a href={vscodeInstallLink(mcpUrl)}>Add to VS Code</a>
          </Button>
          <Snippet label="Or in a terminal" text={vscodeCommand(mcpUrl)} />
        </StepRow>
        <StepRow number={2} title="Start it and sign in to Kanso">
          <p className="text-muted-foreground">
            Start the <Value>kanso</Value> server, and allow it to sign in when VS Code asks. Your browser opens to
            sign in to Kanso.
          </p>
        </StepRow>
        <TryIt number={3} how="In Copilot Chat, in agent mode, ask:" />
      </Steps>
      <Help href="https://code.visualstudio.com/docs/agents/reference/mcp-configuration">VS Code’s help on MCP servers</Help>
    </>
  );
}

function OtherGuide({ mcpUrl }: { mcpUrl: string }) {
  return (
    <>
      <p className="text-muted-foreground">
        Kanso is a remote MCP server (Streamable HTTP) with OAuth sign-in. Most clients need only the URL.
      </p>
      <Snippet label="MCP server URL" text={mcpUrl} />
      <Snippet label="JSON config (clients that use mcpServers)" text={genericConfig(mcpUrl)} />
      <Note>
        <p>
          For clients that can’t sign in, such as scripts and CI, create an API token below and send it as{" "}
          <code className="font-mono text-xs">Authorization: Bearer …</code>.
        </p>
      </Note>
    </>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="flex flex-col">{children}</ol>;
}

function TryIt({ number, how }: { number: number; how: React.ReactNode }) {
  return (
    <StepRow number={number} title="Try it" last>
      <p className="text-muted-foreground">{how}</p>
      <Snippet label="Prompt" text={TRY_IT} />
    </StepRow>
  );
}

function OpenButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild variant="outline" size="sm" className="self-start">
      <a href={href} target="_blank" rel="noreferrer">
        {children}
        <ExternalLink />
      </a>
    </Button>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">{children}</div>;
}

function Help({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}
