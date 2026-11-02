import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";

interface MeanItem {
  name: string;
  done: boolean;
}

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule],
  template: `
    <main class="page">
      <section class="hero">
        <p class="eyebrow">MongoDB, Express.js, Angular, Node.js</p>
        <h1>Devroost MEAN template</h1>
        <p class="lede">A real Angular frontend talking to an Express API over a local proxy.</p>
      </section>

      <section class="status-grid">
        <article>
          <p class="label">Route</p>
          <p>https://mean.devroost.local</p>
        </article>
        <article>
          <p class="label">API status</p>
          <p>{{ status }}</p>
        </article>
      </section>

      <section class="card-list">
        <article class="card" *ngFor="let item of items">
          <h2>{{ item.name }}</h2>
          <p>{{ item.done ? 'done' : 'open' }}</p>
        </article>
      </section>
    </main>
  `,
  styleUrl: "./app.component.css"
})
export class AppComponent implements OnInit {
  items: MeanItem[] = [];
  status = "loading";

  async ngOnInit(): Promise<void> {
    try {
      const [healthResponse, itemsResponse] = await Promise.all([fetch("/api/health"), fetch("/api/items")]);

      if (!healthResponse.ok || !itemsResponse.ok) {
        throw new Error(`Request failed: ${healthResponse.status}/${itemsResponse.status}`);
      }

      const health = (await healthResponse.json()) as { status?: string };
      this.items = (await itemsResponse.json()) as MeanItem[];
      this.status = health.status ?? "ok";
    } catch (error) {
      this.status = `unavailable: ${error}`;
    }
  }
}