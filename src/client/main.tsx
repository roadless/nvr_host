import React from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./pages/AdminApp";
import { InfoApp } from "./pages/InfoApp";
import { ViewerApp } from "./pages/ViewerApp";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);
const currentPath = window.location.pathname;
const isAdmin = currentPath.startsWith("/admin");
const isInfo = currentPath.startsWith("/info");

root.render(
  <React.StrictMode>
    {isAdmin ? <AdminApp /> : isInfo ? <InfoApp /> : <ViewerApp />}
  </React.StrictMode>
);
