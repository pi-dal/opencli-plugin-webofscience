# opencli-plugin-webofscience

Web of Science browser adapter for [opencli](https://github.com/jackwener/opencli).

## Install

```bash
# local development from any location
opencli plugin install /absolute/path/to/opencli-plugin-webofscience

# or, from the plugin repository root
opencli plugin install "$(pwd)"

# after publishing
opencli plugin install github:<user>/opencli-plugin-webofscience
```

`opencli plugin install` accepts a local absolute path for development and a git source such as `github:<user>/<repo>` for published plugins.

## Commands

- `opencli webofscience smart-search "machine learning"`
- `opencli webofscience basic-search "machine learning" --field title`
- `opencli webofscience author-search "Yann LeCun" --affiliation Meta`
- `opencli webofscience author-record 89895674`
- `opencli webofscience record WOS:001335131500001`
- `opencli webofscience references WOS:001335131500001`
- `opencli webofscience citing-articles WOS:001335131500001`

## Development

```bash
npm install
npm test
npm run build

# install or refresh the local symlinked plugin
opencli plugin uninstall webofscience || true
opencli plugin install "$(pwd)"

opencli list | grep webofscience
```

This plugin intentionally lives outside the opencli core repository so it can evolve independently.
