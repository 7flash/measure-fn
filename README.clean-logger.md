# measure-fn clean logger patch

This patch keeps the root/shared-context tracing model and changes the default console formatter from dot-fill lines to compact symbols.

Old style:

```txt
[engine:sy-a-a] ··········································· 13.33ms → {...}
```

New style:

```txt
[http:sy] → GET /api/state c0ao13ti
[http:sy-a] → API: /api/state
[engine:sy-a-a] → snapshot player=1 rev=2068 mapRev=2068
[engine:sy-a-a] ✓ 13.33ms → {"ok":true,"player":1}
[http:sy-a] ✓ 13.85ms → {"status":200}
[http:sy] ✓ 14.03ms → {"status":200}
```

Symbols:

- `→` start
- `✓` success
- `✗` error
- `=` annotation

`dotEndLabel` and `dotChar` were removed from the public config because the default logger no longer uses dot fill.
