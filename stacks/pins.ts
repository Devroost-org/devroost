import { publishedImage } from "./image-pins.js";

export const runtimeImagePins = {
  sqlite353: publishedImage("devroost-sqlite-3"),
  bun1: publishedImage("devroost-bun-1"),
  node22Alpine: publishedImage("devroost-node-22"),
  node24Alpine: publishedImage("devroost-node-24"),
  dotnet8Sdk: publishedImage("devroost-dotnet-8"),
  maven39Temurin21: publishedImage("devroost-java-21"),
  elasticsearch819: publishedImage("elasticsearch-8.19"),
  mariadb118: publishedImage("mariadb-11.8"),
  mongo70: publishedImage("mongo-7.0"),
  mssql2022: publishedImage("mssql-2022"),
  mysql84: publishedImage("mysql-8.4"),
  php84Apache: publishedImage("devroost-php"),
  ruby3312: publishedImage("devroost-ruby-3.3"),
  wordpress683Php84Apache: publishedImage("devroost-wordpress"),
  postgres16Alpine: publishedImage("postgres-16"),
  python312Slim: publishedImage("devroost-python-3.12"),
  redis74Alpine: publishedImage("redis-7.4")
} as const;

export const generatorPins = {
  // Verified 2026-08-17 against Docker Hub: https://hub.docker.com/_/composer
  composerImage: "docker.io/library/composer:2.8.10",
  // Verified 2026-08-17 against RubyGems: https://rubygems.org/gems/bundler/versions/2.6.9
  bundler: "2.6.9",
  // Verified 2026-08-17 against Packagist: https://packagist.org/packages/drupal/recommended-project
  drupalRecommendedProject: "11.2.2",
  // Verified 2026-08-17 against RubyGems: https://rubygems.org/gems/rails/versions/7.1.5
  rails: "7.1.5",
  // Verified 2026-08-17 against Packagist: https://packagist.org/packages/symfony/skeleton
  symfonySkeleton: "7.3.99",
  // Verified 2026-08-17 against Packagist: https://packagist.org/packages/symfony/webapp-pack
  symfonyWebappPack: "1.3.0",
  // Verified 2026-08-17 against Docker Hub: https://hub.docker.com/_/wordpress
  wordpress: "6.8.3"
} as const;
