# Vendored compile-only jars

`spark-api-0.1-20260912.112908-2.jar`: spark's public API (`me.lucko:spark-api`), used by the Ledger spark bridge (PT-04c).

- Licence: MIT, Copyright (c) lucko (Luck) and contributors (`spark-api-LICENSE.txt`, copied from https://github.com/lucko/spark/blob/master/spark-api/LICENSE.txt; the rest of spark is GPLv3, this module is not).
- Source: https://repo.lucko.me/me/lucko/spark-api/0.1-SNAPSHOT/spark-api-0.1-20260912.112908-2.jar (published 2026-09-12; the repository is purged on each publish, which is why the jar is vendored).
- sha256: `e4856b0d2ba56db652ca340821a5b40ad0bdd192cf77707ba0f4557eeb5cb63d` (matches the repository's `.sha256`); sha1 `ebe9fdc7a21d84fcbad1d72b8059ce6157d47d31`.
- Compile-only: never bundled in `ledger.jar`; a server with spark supplies the classes. Gradle does not verify file dependencies, so `VendoredSparkApiTest` checks the hash.
