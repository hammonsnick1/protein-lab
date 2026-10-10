import React from "react";
import { createRoot } from "react-dom/client";
import ProteinLabs from "../app/page";
import "../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Protein Lab could not initialize its desktop window.");

createRoot(root).render(
  <React.StrictMode>
    <ProteinLabs />
  </React.StrictMode>,
);
