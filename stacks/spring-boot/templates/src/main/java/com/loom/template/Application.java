package com.loom.template;

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
        "language", "java-21",
        "updatedFor", "2026"
      );
    }

    @GetMapping("/api/hello")
    public Map<String, Object> hello() {
      return Map.of(
        "message", "Hello from Devroost Spring Boot template",
        "tip", "Start building your API in src/main/java/com/loom/template/"
      );
    }
  }
}
