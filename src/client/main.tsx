import React from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./pages/AdminApp";
import { ViewerApp } from "./pages/ViewerApp";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);
const isAdmin = window.location.pathname.startsWith("/admin");

root.render(
  <React.StrictMode>
    {isAdmin ? <AdminApp /> : <ViewerApp />}
  </React.StrictMode>
);
