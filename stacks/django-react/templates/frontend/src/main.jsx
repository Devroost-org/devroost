import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  const [items, setItems] = React.useState([]);
  const [status, setStatus] = React.useState("Loading todos from Django...");

  React.useEffect(() => {
    fetch("/api/todos")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }

        return response.json();
      })
      .then((data) => {
        setItems(data.items ?? []);
        setStatus("Django API connected");
      })
      .catch((error) => {
        setStatus(`Unable to load todos: ${error}`);
      });
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h1>Devroost Django + React template</h1>
      <p>{status}</p>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.title}</strong>
            {item.completed ? " - done" : " - next up"}
          </li>
        ))}
      </ul>
      <p>Frontend: http://django-react.devroost.local</p>
      <p>Backend health: /api/health</p>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);