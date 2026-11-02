import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { S } from "./strings";
import "./styles.css";

document.title = S.pageTitle;

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
