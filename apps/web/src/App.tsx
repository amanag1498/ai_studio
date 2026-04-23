import { useEffect, useState } from "react";
import { AuthLandingPage } from "./components/AuthLandingPage";
import { BuilderPage } from "./components/BuilderPage";
import { FileLibraryPage } from "./components/FileLibraryPage";
import { PublishedChatPage } from "./components/PublishedChatPage";
import { RunPage } from "./components/RunPage";
import { WorkflowAppPage } from "./components/WorkflowAppPage";
import { WorkflowsPage } from "./components/WorkflowsPage";
import type { AppUser } from "./lib/api";

function navigateTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("vmb:navigate"));
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    try {
      const savedUser = localStorage.getItem("vmb-local-user");
      return savedUser ? (JSON.parse(savedUser) as AppUser) : null;
    } catch {
      return null;
    }
  });

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

  if (!currentUser && !chatMatch) {
    return (
      <AuthLandingPage
        onAuthenticated={(user) => {
          setCurrentUser(user);
          navigateTo("/");
        }}
      />
    );
  }

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
      authenticatedUser={currentUser}
      onLogout={() => {
        localStorage.removeItem("vmb-local-user");
        localStorage.removeItem("vmb-local-session-token");
        setCurrentUser(null);
        navigateTo("/");
      }}
      onCreateWorkflow={() => navigateTo("/builder")}
      onOpenWorkflow={(workflowId) => navigateTo(`/builder/${workflowId}`)}
      onOpenChat={(slug) => navigateTo(`/chat/${slug}`)}
      onOpenWorkflowApp={(workflowId) => navigateTo(`/app/${workflowId}`)}
      onOpenFiles={() => navigateTo("/files")}
    />
  );
}
