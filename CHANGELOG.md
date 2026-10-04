# Changelog

## [0.2.0](https://github.com/guneet-xyz/dockyard/compare/v0.1.0...v0.2.0) (2026-10-04)


### Features

* delete image repositories and projects with typed confirmation ([02831c6](https://github.com/guneet-xyz/dockyard/commit/02831c6b261e5607a2235f5e6817a28749d2fec0))


### Bug Fixes

* **ci:** bind publishing credentials directly to release environment ([d830468](https://github.com/guneet-xyz/dockyard/commit/d8304687983385a061174682638ab4ee40386c15))
* **ci:** declare release environment credentials in reusable publisher ([c2fe59c](https://github.com/guneet-xyz/dockyard/commit/c2fe59c8e257a424adfe2ad731ece9803516e302))
* **ci:** generate release metadata from the explicit source SHA ([be2f771](https://github.com/guneet-xyz/dockyard/commit/be2f771fa97f93953b927f758855c64d7a75aec4))
* **ci:** verify scoped push permissions before building images ([6985716](https://github.com/guneet-xyz/dockyard/commit/6985716d77cc6287fb2c2597c821460a1b5c4523))

## 0.1.0 (2026-10-03)


### Features

* add projects and two-level image namespaces ([0f4b76f](https://github.com/guneet-xyz/dockyard/commit/0f4b76f5c1a6ac0f7a6495b3fdbe0aef77a8daa1))
* add scoped automation keys for projects and images ([5e4fce9](https://github.com/guneet-xyz/dockyard/commit/5e4fce9610418de6ffd066164788a63106423bef))
* add single-endpoint ingress for web and registry ([0a93c08](https://github.com/guneet-xyz/dockyard/commit/0a93c08e6677a3adfe8a9e989d1dfa61eefca85b))
* build Dockyard registry with RBAC and Docker Compose deployment ([7b48b17](https://github.com/guneet-xyz/dockyard/commit/7b48b174af000c538a576977728ca050ded278e2))
* **ci:** publish multi-arch images and automate conventional releases ([f2fece9](https://github.com/guneet-xyz/dockyard/commit/f2fece90da62bbfc723487d22daff7f879a413cb))
* download one-time automation key credentials as JSON ([f50aa6f](https://github.com/guneet-xyz/dockyard/commit/f50aa6faac9a4ec7c2d06b65788ea30387f9da5a))
* generate ingress configuration from environment URLs ([49ea4b6](https://github.com/guneet-xyz/dockyard/commit/49ea4b6d2f97beb909448260128a1f147ccc4c73))
* rotate automation key secrets in place ([ae5dc22](https://github.com/guneet-xyz/dockyard/commit/ae5dc225aa6bf74caa03425ba6ce649a7157beba))
* select automation key projects and images from dropdowns ([e2bd1d7](https://github.com/guneet-xyz/dockyard/commit/e2bd1d71ae55fd31d283ae37ada4f68e2fd613dc))


### Bug Fixes

* **ci:** bootstrap 0.1.0 and unblock release validation ([986f1bf](https://github.com/guneet-xyz/dockyard/commit/986f1bf3d48a78896a5e2b84faa41a93f53dfc76))
* contain automation key credentials within save dialog ([c9f3131](https://github.com/guneet-xyz/dockyard/commit/c9f31318c33a73411eb04c99b43acebae34e26b2))
* keep Compose ingress HTTP behind TLS proxies ([6c019d7](https://github.com/guneet-xyz/dockyard/commit/6c019d7b00979659b071cb0a443dea0452b25707))
