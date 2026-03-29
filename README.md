# opencli-plugin-webofscience

Web of Science browser adapter for [opencli](https://github.com/jackwener/opencli).

## Install

```bash
# local development
opencli plugin install file:///Users/pi-dal/Developer/opencli-plugin-webofscience

# after publishing
opencli plugin install github:<user>/opencli-plugin-webofscience
```

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
opencli plugin install file:///Users/pi-dal/Developer/opencli-plugin-webofscience
opencli list | grep webofscience
```

This plugin intentionally lives outside the opencli core repository so it can evolve independently.
