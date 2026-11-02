package com.devroost.template;

import java.util.List;
import java.util.Map;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class Application {
  public static void main(String[] args) {
    SpringApplication.run(Application.class, args);
  }

  @RestController
  static class ApiController {
    @GetMapping("/api/health")
    public Map<String, Object> health() {
      return Map.of(
        "status", "ok",
        "runtime", "spring-boot-3.3",
        "language", "java",
        "updatedFor", "2026"
      );
    }

    @GetMapping("/api/hello")
    public Map<String, Object> hello() {
      return Map.of(
        "title", "Devroost Spring + React template",
        "subtitle", "A Spring Boot API with a React frontend wired through a local /api proxy.",
        "features", List.of(
          "Spring Boot backend on Java 21",
          "Built React frontend served locally by Node",
          "Local /api proxy for same-origin frontend calls"
        )
      );
    }
  }
}
