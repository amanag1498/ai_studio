import { useEffect, useState } from "react";
import { BuilderPage } from "./components/BuilderPage";
import { FileLibraryPage } from "./components/FileLibraryPage";
import { PublishedChatPage } from "./components/PublishedChatPage";
import { RunPage } from "./components/RunPage";
import { WorkflowAppPage } from "./components/WorkflowAppPage";
import { WorkflowsPage } from "./components/WorkflowsPage";

function navigateTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("vmb:navigate"));
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    function syncPath() {
      setPath(window.location.pathname);
    }

    window.addEventListener("popstate", syncPath);
    window.addEventListener("vmb:navigate", syncPath);

    return () => {
      window.removeEventListener("popstate", syncPath);
      window.removeEventListener("vmb:navigate", syncPath);
    };
  }, []);

  const builderMatch = path.match(/^\/builder\/(\d+)$/);
  const chatMatch = path.match(/^\/chat\/([^/]+)$/);
  const appMatch = path.match(/^\/app\/(\d+)$/);
  const runMatch = path.match(/^\/runs\/(\d+)\/(\d+)$/);

  if (runMatch) {
    return (
      <RunPage
        workflowId={Number(runMatch[1])}
        runId={Number(runMatch[2])}
        onBack={() => navigateTo(`/builder/${runMatch[1]}`)}
      />
    );
  }

  if (builderMatch) {
    return (
      <BuilderPage
        workflowId={Number(builderMatch[1])}
        onBack={() => navigateTo("/")}
        onOpenChat={(slug) => navigateTo(`/chat/${slug}`)}
        onOpenRun={(run) => navigateTo(`/runs/${run.workflow_id}/${run.id}`)}
      />
    );
  }

  if (appMatch) {
    return (
      <WorkflowAppPage
        workflowId={Number(appMatch[1])}
        onBack={() => navigateTo("/")}
        onOpenBuilder={(workflowId) => navigateTo(`/builder/${workflowId}`)}
        onOpenRun={(run) => navigateTo(`/runs/${run.workflow_id}/${run.id}`)}
      />
    );
  }

  if (path === "/builder") {
    return (
      <BuilderPage
        onBack={() => navigateTo("/")}
        onOpenChat={(slug) => navigateTo(`/chat/${slug}`)}
        onOpenRun={(run) => navigateTo(`/runs/${run.workflow_id}/${run.id}`)}
      />
    );
  }

  if (path === "/files") {
    return <FileLibraryPage onBack={() => navigateTo("/")} onOpenWorkflow={(workflowId) => navigateTo(`/builder/${workflowId}`)} />;
  }

  if (chatMatch) {
    return <PublishedChatPage slug={chatMatch[1]} onBack={() => navigateTo("/")} />;
  }

  return (
    <WorkflowsPage
      onCreateWorkflow={() => navigateTo("/builder")}
      onOpenWorkflow={(workflowId) => navigateTo(`/builder/${workflowId}`)}
      onOpenChat={(slug) => navigateTo(`/chat/${slug}`)}
      onOpenWorkflowApp={(workflowId) => navigateTo(`/app/${workflowId}`)}
      onOpenFiles={() => navigateTo("/files")}
    />
  );
}
