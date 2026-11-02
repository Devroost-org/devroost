import type { StackDocumentation, StackId } from "./definition.js";

const application = (
  summary: string,
  useCase: string,
  initCommand: string,
  services: StackDocumentation["services"],
  endpoints: StackDocumentation["endpoints"],
  notes: StackDocumentation["notes"] = []
): StackDocumentation => ({ summary, useCase, initCommand, supportsOptionalDatabases: true, services, endpoints, notes });

const database = (
  summary: string,
  useCase: string,
  initCommand: string,
  services: StackDocumentation["services"],
  endpoints: StackDocumentation["endpoints"],
  notes: StackDocumentation["notes"] = []
): StackDocumentation => ({ summary, useCase, initCommand, supportsOptionalDatabases: false, services, endpoints, notes });

export const stackDocumentation = {
  astro: application(
    "Astro starter with a Node.js development server.",
    "Choose Astro for content-focused sites that need component islands and a fast local frontend workflow.",
    "devroost init astro --dir astro-site",
    [{ name: "app", purpose: "Astro development server" }],
    [{ label: "Website", value: "https://astro.devroost.local:8443" }, { label: "Direct port", value: "http://localhost:4321" }]
  ),
  bun: application(
    "Small HTTP application running on Bun.",
    "Choose Bun when you want its JavaScript runtime, package manager, and test runner in a minimal starter.",
    "devroost init bun --dir bun-app",
    [{ name: "app", purpose: "Bun application server" }],
    [{ label: "Application", value: "https://bun.devroost.local:8443" }, { label: "Direct port", value: "http://localhost:3004" }]
  ),
  "db-all": database(
    "Combined local environment containing every supported database.",
    "Choose this stack for compatibility testing or data work that genuinely needs several database engines at once.",
    "devroost init db-all --dir local-databases",
    [
      { name: "mysql", purpose: "MySQL 8.4 server" }, { name: "sqlserver", purpose: "SQL Server 2022" },
      { name: "postgres", purpose: "PostgreSQL 16 server" }, { name: "mongodb", purpose: "MongoDB 7 server" },
      { name: "redis", purpose: "Redis 7.4 server" }, { name: "elasticsearch", purpose: "Elasticsearch 8.19 node" },
      { name: "sqlite", purpose: "Persistent SQLite database" }, { name: "mariadb", purpose: "MariaDB 11.8 server" }
    ],
    [
      { label: "MySQL", value: "localhost:3306" }, { label: "SQL Server", value: "localhost:1433" },
      { label: "PostgreSQL", value: "localhost:5432" }, { label: "MongoDB", value: "localhost:27017" },
      { label: "Redis", value: "localhost:6379" }, { label: "Elasticsearch", value: "http://localhost:9200" },
      { label: "SQLite file", value: "data/sqlite/devroost.db" }, { label: "MariaDB", value: "localhost:3307" }
    ],
    ["SQL Server makes this combined stack x64-only.", "Start only the databases you need when lower memory use matters."]
  ),
  "db-elasticsearch": database(
    "Standalone Elasticsearch 8.19 node.",
    "Choose this stack for local search, indexing, and Elasticsearch client development without an application template.",
    "devroost init db-elasticsearch --dir elasticsearch-local",
    [{ name: "db", purpose: "Single-node Elasticsearch server" }],
    [{ label: "HTTP API", value: "http://localhost:9200" }, { label: "Transport port", value: "localhost:9300" }]
  ),
  "db-mariadb": database(
    "Standalone MariaDB 11.8 database.",
    "Choose this stack for MariaDB-specific SQL development or to connect an application managed outside Devroost.",
    "devroost init db-mariadb --dir mariadb-local",
    [{ name: "db", purpose: "MariaDB server" }],
    [{ label: "Database", value: "localhost:3307" }]
  ),
  "db-mongodb": database(
    "Standalone MongoDB 7 database.",
    "Choose this stack for document-database development or to connect an application managed outside Devroost.",
    "devroost init db-mongodb --dir mongodb-local",
    [{ name: "db", purpose: "MongoDB server" }],
    [{ label: "Database", value: "localhost:27017" }]
  ),
  "db-mysql": database(
    "Standalone MySQL 8.4 database.",
    "Choose this stack for MySQL-specific SQL development or to connect an application managed outside Devroost.",
    "devroost init db-mysql --dir mysql-local",
    [{ name: "db", purpose: "MySQL server" }],
    [{ label: "Database", value: "localhost:3306" }]
  ),
  "db-postgres": database(
    "Standalone PostgreSQL 16 database.",
    "Choose this stack for PostgreSQL development or to connect an application managed outside Devroost.",
    "devroost init db-postgres --dir postgres-local",
    [{ name: "db", purpose: "PostgreSQL server" }],
    [{ label: "Database", value: "localhost:5432" }]
  ),
  "db-redis": database(
    "Standalone Redis 7.4 data store.",
    "Choose this stack for cache, queue, session, and Redis client development without an application template.",
    "devroost init db-redis --dir redis-local",
    [{ name: "db", purpose: "Redis server with append-only persistence" }],
    [{ label: "Redis", value: "localhost:6379" }]
  ),
  "db-sqlite": database(
    "Persistent SQLite database with the SQLite CLI.",
    "Choose this stack when you want a simple file-backed database and command-line access without a network server.",
    "devroost init db-sqlite --dir sqlite-local",
    [{ name: "db", purpose: "SQLite CLI container keeping the database file available" }],
    [{ label: "Database file", value: "data/sqlite/devroost.db" }],
    ["SQLite does not expose a TCP port; applications use the database file."]
  ),
  "db-sqlserver": database(
    "Standalone Microsoft SQL Server 2022 database.",
    "Choose this stack for SQL Server development and compatibility testing on an x64 host.",
    "devroost init db-sqlserver --dir sqlserver-local",
    [{ name: "db", purpose: "Microsoft SQL Server" }],
    [{ label: "Database", value: "localhost:1433" }],
    ["The published SQL Server image supports x64 hosts only."]
  ),
  "django-react": application(
    "Django API with a React frontend.",
    "Choose this stack for a Python backend and modern React client developed as two coordinated services.",
    "devroost init django-react --dir django-react-app",
    [{ name: "backend", purpose: "Django API and migrations" }, { name: "web", purpose: "React development server" }],
    [{ label: "Application", value: "https://django-react.devroost.local:8443" }, { label: "Backend health", value: "http://localhost:8001/health" }, { label: "Frontend", value: "http://localhost:5176" }]
  ),
  dotnet: application(
    ".NET 8 web application starter.",
    "Choose this stack for ASP.NET Core development using the published .NET SDK image.",
    "devroost init dotnet --dir dotnet-app",
    [{ name: "app", purpose: "ASP.NET Core development server" }],
    [{ label: "Application", value: "https://dotnet.devroost.local:8443" }, { label: "Direct port", value: "http://localhost:5000" }]
  ),
  jamstack: application(
    "Node.js API paired with a frontend development server.",
    "Choose this stack for a decoupled frontend and API that can evolve and deploy independently.",
    "devroost init jamstack --dir jamstack-app",
    [{ name: "api", purpose: "Node.js JSON API" }, { name: "web", purpose: "Frontend development server" }],
    [{ label: "Website", value: "https://jamstack.devroost.local:8443" }, { label: "API", value: "http://localhost:3006" }, { label: "Frontend", value: "http://localhost:5174" }]
  ),
  node: application(
    "Minimal Express application on Node.js 24.",
    "Choose this starter for a small Node.js service or as a clear base for an existing JavaScript application.",
    "devroost init node --dir node-app",
    [{ name: "app", purpose: "Express application server" }],
    [{ label: "Application", value: "https://node.devroost.local:8443" }, { label: "Health endpoint", value: "http://localhost:3000/health" }]
  ),
  "node-mean": application(
    "MongoDB-oriented Express and Angular application.",
    "Choose this stack for a MEAN-style project with separate Node.js API and Angular frontend services.",
    "devroost init node-mean --dir mean-app",
    [{ name: "api", purpose: "Express API" }, { name: "web", purpose: "Angular development server" }],
    [{ label: "Application", value: "https://mean.devroost.local:8443" }, { label: "API health", value: "http://localhost:3001/health" }, { label: "Frontend", value: "http://localhost:4200" }]
  ),
  "node-mern": application(
    "MongoDB-oriented Express and React application.",
    "Choose this stack for a MERN-style project with separate Node.js API and React frontend services.",
    "devroost init node-mern --dir mern-app",
    [{ name: "api", purpose: "Express API" }, { name: "web", purpose: "React development server" }],
    [{ label: "Application", value: "https://mern.devroost.local:8443" }, { label: "API health", value: "http://localhost:3002/health" }, { label: "Frontend", value: "http://localhost:5173" }]
  ),
  "node-t3": application(
    "T3-style TypeScript application using pnpm.",
    "Choose this stack for a typed full-stack Node.js project with a single development service.",
    "devroost init node-t3 --dir t3-app",
    [{ name: "app", purpose: "T3 application development server" }],
    [{ label: "Application", value: "https://t3.devroost.local:8443" }, { label: "Direct port", value: "http://localhost:3003" }]
  ),
  php: application(
    "PHP 8.4 application served by Apache.",
    "Choose this starter for a traditional PHP application with Composer and common development extensions available.",
    "devroost init php --dir php-app",
    [{ name: "app", purpose: "Apache and PHP application server" }],
    [{ label: "Application", value: "https://php.devroost.local:8443" }, { label: "Direct port", value: "http://localhost:8085" }]
  ),
  "php-drupal": application(
    "Drupal project served by Apache and PHP 8.4.",
    "Choose this stack for local Drupal module, theme, and site development.",
    "devroost init php-drupal --dir drupal-site --db mysql",
    [{ name: "app", purpose: "Drupal application server" }],
    [{ label: "Drupal site", value: "https://drupal.devroost.local:8443" }, { label: "Direct port", value: "http://localhost:8091" }],
    ["Add MySQL or MariaDB during initialization for a complete Drupal site."]
  ),
  "php-symfony": application(
    "Symfony application served by Apache and PHP 8.4.",
    "Choose this stack for Symfony web or API development with Composer-managed dependencies.",
    "devroost init php-symfony --dir symfony-app",
    [{ name: "app", purpose: "Symfony application server" }],
    [{ label: "Application", value: "https://symfony.devroost.local:8443" }, { label: "Direct port", value: "http://localhost:8092" }]
  ),
  "php-wordpress": application(
    "WordPress 6.8 project served by Apache and PHP 8.4.",
    "Choose this stack for WordPress theme, plugin, and site development with project files on the host.",
    "devroost init php-wordpress --dir wordpress-site --db mysql",
    [{ name: "app", purpose: "WordPress application server" }],
    [{ label: "WordPress site", value: "https://wordpress.devroost.local:8443" }, { label: "Direct port", value: "http://localhost:8090" }],
    ["A MySQL-compatible database is required for a working WordPress site."]
  ),
  python: application(
    "Minimal Python 3.12 HTTP application.",
    "Choose this starter for a small Python service or as a base for an existing Python project.",
    "devroost init python --dir python-app",
    [{ name: "app", purpose: "Python HTTP server" }],
    [{ label: "Application", value: "https://python.devroost.local:8443" }, { label: "Direct port", value: "http://localhost:8000" }]
  ),
  "python-django": application(
    "Django web application with migrations and tests.",
    "Choose this stack for a server-rendered Django project or Python web API.",
    "devroost init python-django --dir django-app",
    [{ name: "app", purpose: "Django development server" }],
    [{ label: "Application", value: "https://django.devroost.local:8443" }, { label: "Health endpoint", value: "http://localhost:8001/health" }]
  ),
  "python-fastapi": application(
    "FastAPI application running with Uvicorn.",
    "Choose this stack for typed Python APIs with automatic OpenAPI documentation.",
    "devroost init python-fastapi --dir fastapi-app",
    [{ name: "app", purpose: "FastAPI and Uvicorn server" }],
    [{ label: "Application", value: "https://fastapi.devroost.local:8443" }, { label: "Health endpoint", value: "http://localhost:8003/health" }]
  ),
  "python-flask": application(
    "Flask web application on Python 3.12.",
    "Choose this stack for a small Python web application or API with minimal framework structure.",
    "devroost init python-flask --dir flask-app",
    [{ name: "app", purpose: "Flask development server" }],
    [{ label: "Application", value: "https://flask.devroost.local:8443" }, { label: "Health endpoint", value: "http://localhost:8002/health" }]
  ),
  rails7: application(
    "Ruby on Rails 7 application.",
    "Choose this stack for conventional server-rendered Rails development on Ruby 3.3.",
    "devroost init rails7 --dir rails-app",
    [{ name: "app", purpose: "Rails development server" }],
    [{ label: "Application", value: "https://rails7.devroost.local:8443" }, { label: "Direct port", value: "http://localhost:3006" }]
  ),
  "rails7-hotwire": application(
    "Ruby on Rails 7 application prepared for Hotwire.",
    "Choose this stack for Rails development centered on Turbo and Stimulus interactions.",
    "devroost init rails7-hotwire --dir rails-hotwire-app",
    [{ name: "app", purpose: "Rails and Hotwire development server" }],
    [{ label: "Application", value: "https://rails7-hotwire.devroost.local:8443" }, { label: "Direct port", value: "http://localhost:3008" }]
  ),
  serverless: application(
    "Local serverless-style Node.js API with a web client.",
    "Choose this stack to develop and invoke function-shaped handlers alongside a browser frontend.",
    "devroost init serverless --dir serverless-app",
    [{ name: "api", purpose: "Local function API emulator" }, { name: "web", purpose: "Static web development server" }],
    [{ label: "Application", value: "https://serverless.devroost.local:8443" }, { label: "API health", value: "http://localhost:3007/health" }, { label: "Frontend", value: "http://localhost:3008" }]
  ),
  "spring-boot": application(
    "Spring Boot application on Java 21.",
    "Choose this stack for a Java web service built and run with Maven.",
    "devroost init spring-boot --dir spring-app",
    [{ name: "app", purpose: "Spring Boot application server" }],
    [{ label: "Application", value: "https://spring-boot.devroost.local:8443" }, { label: "Health endpoint", value: "http://localhost:8080/api/health" }]
  ),
  "spring-react": application(
    "Spring Boot API with a React frontend.",
    "Choose this stack for a Java backend and React client developed as coordinated services.",
    "devroost init spring-react --dir spring-react-app",
    [{ name: "backend", purpose: "Spring Boot API" }, { name: "web", purpose: "React frontend server" }],
    [{ label: "Application", value: "https://spring-react.devroost.local:8443" }, { label: "Backend", value: "http://localhost:8081" }, { label: "Frontend", value: "http://localhost:5175" }]
  )
} satisfies Readonly<Record<StackId, StackDocumentation>>;
