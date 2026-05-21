# Plane PMO - Rust Rewrite

A ground-up rewrite of [Plane](https://github.com/makeplane/plane) (project management) backend in Rust, targeting single-binary deployment on resource-constrained VPS (1 core / 1 GB RAM).

## Why

| Metric | Plane (Python/Node) | This Project (Rust) |
|---|---|---|
| Containers | 12 | 1 (+ optional Redis) |
| RAM (idle) | ~2.5 GB | ~300 MB |
| RAM (under load) | 4-8 GB | ~500 MB |
| Min VPS | 2 core / 4 GB ($12/mo) | 1 core / 1 GB ($4/mo) |
| Cold start | 30-60s (all containers) | <100ms |
| Deploy complexity | docker-compose with 12 services | Single binary |

## Documentation

- [`prd.md`](./prd.md) - Product Requirements Document & Roadmap
