import "@fontsource-variable/inter-tight";
import "./style.css";
import { StoryProjversorApp } from "./StoryProjversorApp";

const root = document.getElementById("app");
if (root) {
  const fail = (error: unknown) => {
    console.error(error);
    root.querySelector('[data-ref="status"]')!.textContent = String(error);
  };
  try {
    new StoryProjversorApp(root).start().catch(fail);
  } catch (error) {
    fail(error);
  }
}
