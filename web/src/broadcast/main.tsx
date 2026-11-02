import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Broadcast } from "./Broadcast";
import { S } from "../strings";
import "./broadcast.css";

document.title = S.bc.pageTitle;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary label={S.partBroadcast}><Broadcast /></ErrorBoundary>
  </StrictMode>,
);
