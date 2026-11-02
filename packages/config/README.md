# @devroost/config

Configuration loading and validation for Devroost projects.

- Parses `devroost.yaml`
- Loads project `.env` values
- Expands `${VAR}` and `${VAR:-default}` placeholders inside config strings
- Validates schema/types
- Resolves project config roots
