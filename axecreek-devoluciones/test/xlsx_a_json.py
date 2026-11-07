import openpyxl, json, sys, datetime
src, dst = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True)
out = {}
for ws in wb:
    rows = []
    for r in ws.iter_rows(values_only=True):
        row = []
        for v in list(r)[:40]:
            if isinstance(v, datetime.datetime): v = {"__d": v.isoformat()}
            elif isinstance(v, datetime.date): v = {"__d": datetime.datetime(v.year, v.month, v.day).isoformat()}
            elif v is None: v = ""
            row.append(v)
        rows.append(row)
    while rows and not any(x != "" for x in rows[-1]): rows.pop()
    out[ws.title] = rows
json.dump(out, open(dst, "w"), ensure_ascii=False)
print({k: len(v) for k, v in out.items()})
