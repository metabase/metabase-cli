#!/usr/bin/env python3
"""Build a metadata plan: map each ClickHouse transform table to its dbt model
metadata (descriptions + semantic types + display names) and emit a reviewable
plan plus a concrete apply manifest.

Inputs:
  --db-meta   db2_full.json   (mb db metadata 2 --full)
  --transforms transforms.json (mb transform list)
  --models    path to dbt-models/models
Outputs (into --out dir):
  plan/<schema>.yaml   human-reviewable, per schema
  apply.jsonl          concrete {kind,id,name,body} changes for apply.py
  summary.md           stats
"""
import argparse, json, os, re, glob, sys
from collections import defaultdict
import yaml

def get_meta_block(node):
    """Return the metabase.* dict from a dbt node, checking config.meta then meta."""
    out = {}
    for container in (node.get('config') or {}, node):
        meta = container.get('meta') if isinstance(container, dict) else None
        if isinstance(meta, dict):
            for k, v in meta.items():
                if isinstance(k, str) and k.startswith('metabase.'):
                    out.setdefault(k[len('metabase.'):], v)
    return out

# Known dbt typos in metabase.semantic_type -> canonical Metabase type (case-sensitive API)
SEMANTIC_FIX = {'type/category': 'type/Category'}

def fix_semantic(s):
    if s is None:
        return None
    return SEMANTIC_FIX.get(s, s)

def norm_desc(s):
    if s is None:
        return None
    # dbt yaml folds multi-line scalars with newlines -> collapse whitespace
    s = re.sub(r'\s+', ' ', str(s)).strip()
    return s or None

def parse_models(models_dir):
    """model_name -> {description, display_name, columns:{col:{description,semantic_type,display_name}}}"""
    models = {}
    paths = (glob.glob(os.path.join(models_dir, '**', '*.yml'), recursive=True)
             + glob.glob(os.path.join(models_dir, '**', '*.yaml'), recursive=True))
    for path in paths:
        try:
            doc = yaml.safe_load(open(path))
        except Exception as e:
            print(f'WARN parse {path}: {e}', file=sys.stderr)
            continue
        if not isinstance(doc, dict):
            continue
        for m in (doc.get('models') or []):
            name = m.get('name')
            if not name:
                continue
            mmeta = get_meta_block(m)
            cols = {}
            for c in (m.get('columns') or []):
                cn = c.get('name')
                if not cn:
                    continue
                cmeta = get_meta_block(c)
                cols[cn] = {
                    'description': norm_desc(c.get('description')),
                    'semantic_type': fix_semantic(cmeta.get('semantic_type')),
                    'display_name': cmeta.get('display_name'),
                }
            models[name] = {
                'description': norm_desc(m.get('description')),
                'display_name': mmeta.get('display_name'),
                'columns': cols,
                '_src': os.path.relpath(path, models_dir),
            }
    return models

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db-meta', required=True)
    ap.add_argument('--transforms', required=True)
    ap.add_argument('--models', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    db = json.load(open(a.db_meta))
    tables = db.get('tables', [])
    tlist = json.load(open(a.transforms))
    tlist = tlist.get('data', tlist)
    tid2name = {t['id']: t['name'] for t in tlist}

    models = parse_models(a.models)
    print(f'parsed dbt models with metadata: {len(models)}', file=sys.stderr)

    plan_by_schema = defaultdict(list)
    apply_rows = []
    stats = defaultdict(int)
    unmatched_tables = []
    missing_cols = defaultdict(list)  # model -> dbt cols not found in table

    for tbl in tables:
        tid = tbl.get('transform_id')
        schema = tbl.get('schema') or ''
        if tid is None and not schema.startswith('transforms_'):
            continue  # not a transform-backed table
        stats['transform_tables'] += 1
        model_name = tid2name.get(tid) or tbl.get('name')
        meta = models.get(model_name)
        if not meta:
            unmatched_tables.append((schema, tbl.get('name'), model_name))
            stats['tables_no_dbt_meta'] += 1
            continue
        stats['tables_matched'] += 1

        # ---- table-level ----
        tbl_changes = {}
        cur_desc = tbl.get('description')
        if meta['description'] and norm_desc(cur_desc) != meta['description']:
            tbl_changes['description'] = meta['description']
        # display_name only if dbt explicitly set one and it differs
        if meta['display_name'] and tbl.get('display_name') != meta['display_name']:
            tbl_changes['display_name'] = meta['display_name']
        if tbl_changes:
            apply_rows.append({'kind': 'table', 'id': tbl['id'],
                               'name': f"{schema}.{tbl['name']}", 'body': tbl_changes})
            stats['table_updates'] += 1
            for k in tbl_changes:
                stats[f'table_set_{k}'] += 1

        # ---- field-level ----
        fields = {f['name']: f for f in tbl.get('fields', [])}
        field_plan = []
        dbt_cols = meta['columns']
        for cname, dbt in dbt_cols.items():
            f = fields.get(cname)
            if not f:
                missing_cols[model_name].append(cname)
                continue
            body = {}
            if dbt['description'] and norm_desc(f.get('description')) != dbt['description']:
                body['description'] = dbt['description']
            if dbt['semantic_type'] and f.get('semantic_type') != dbt['semantic_type']:
                body['semantic_type'] = dbt['semantic_type']
            if dbt['display_name'] and f.get('display_name') != dbt['display_name']:
                body['display_name'] = dbt['display_name']
            if body:
                apply_rows.append({'kind': 'field', 'id': f['id'],
                                   'name': f"{schema}.{tbl['name']}.{cname}", 'body': body})
                stats['field_updates'] += 1
                for k in body:
                    stats[f'field_set_{k}'] += 1
            field_plan.append({'field': cname, 'current': {
                'description': f.get('description'), 'semantic_type': f.get('semantic_type'),
                'display_name': f.get('display_name')}, 'new': body or 'no change'})

        plan_by_schema[schema].append({
            'table': tbl['name'], 'table_id': tbl['id'], 'dbt_model': model_name,
            'dbt_source': meta['_src'],
            'table_changes': tbl_changes or 'no change',
            'fields': field_plan,
        })

    # ---- write outputs ----
    os.makedirs(os.path.join(a.out, 'plans'), exist_ok=True)
    for schema, entries in sorted(plan_by_schema.items()):
        entries.sort(key=lambda e: e['table'])
        with open(os.path.join(a.out, 'plans', f'{schema}.yaml'), 'w') as fh:
            yaml.safe_dump({'schema': schema, 'tables': entries}, fh,
                           sort_keys=False, allow_unicode=True, width=1000, default_flow_style=False)

    with open(os.path.join(a.out, 'apply.jsonl'), 'w') as fh:
        for r in apply_rows:
            fh.write(json.dumps(r, ensure_ascii=False) + '\n')

    with open(os.path.join(a.out, 'summary.md'), 'w') as fh:
        fh.write('# Transform table metadata plan\n\n')
        fh.write('Source of truth: dbt `schema.yml` (`description`, `config.meta.metabase.semantic_type`, `config.meta.metabase.display_name`).\n')
        fh.write('Each ClickHouse transform table is matched to its dbt model via `transform_id`.\n\n')
        fh.write('## Stats\n\n')
        for k in sorted(stats):
            fh.write(f'- **{k}**: {stats[k]}\n')
        fh.write(f'- **total apply operations**: {len(apply_rows)}\n')
        if unmatched_tables:
            fh.write(f'\n## Transform tables with no dbt metadata ({len(unmatched_tables)})\n\n')
            for schema, name, model in sorted(unmatched_tables):
                fh.write(f'- `{schema}.{name}` (model `{model}`)\n')
        miss_total = sum(len(v) for v in missing_cols.values())
        if missing_cols:
            fh.write(f'\n## dbt columns not present on the ClickHouse table ({miss_total})\n\n')
            for model in sorted(missing_cols):
                fh.write(f'- `{model}`: {", ".join(sorted(missing_cols[model]))}\n')

    print('STATS:', dict(stats), file=sys.stderr)
    print('apply ops:', len(apply_rows), file=sys.stderr)
    print('unmatched tables:', len(unmatched_tables), file=sys.stderr)

if __name__ == '__main__':
    main()
