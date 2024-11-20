import dotenv from "dotenv";
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "starfx/react";
import App from "./App"; // Assuming App is your main component
import { schema } from "./state/schema";
import { setupState } from "./state/store";

const { store } = await setupState();
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <Provider store={store} schema={schema}>
      <App />
    </Provider>
  </React.StrictMode>,
);
