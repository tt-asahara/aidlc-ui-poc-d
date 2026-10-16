#!/usr/bin/env python3
"""Narrow source-backed static checks; NOT upstream plugin validate/build/compose."""
import argparse, hashlib, json, os, pathlib, re
root=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-root', default=os.environ.get('UI_POC_SOURCE_ROOT'), help='Pinned upstream source tree; or UI_POC_SOURCE_ROOT')
parser.add_argument('--tree', default=os.environ.get('UI_POC_UPSTREAM_TREE'), help='Pinned Git tree JSON; or UI_POC_UPSTREAM_TREE')
args=parser.parse_args()
if not args.source_root or not args.tree:
 parser.error('Provide --source-root and --tree (or their documented environment variables)')
source=pathlib.Path(args.source_root)
tree=json.loads(pathlib.Path(args.tree).read_text())
assert tree.get('sha') == '6a378b53c0a4fe0641ed7d8de8dfff94264d5b6a', 'Wrong upstream revision'
assert tree.get('truncated') is False, 'Truncated or unspecified tree completeness'
blobs={x['path']:x.get('sha') for x in tree['tree'] if x['type']=='blob'}
manifest=json.loads((root/'.aidlc-plugin/plugin.json').read_text())
assert manifest['name']=='ui-poc'
for k,v in manifest['aidlc']['contributes'].items():
 assert v=={'overlays':'contributions/','scopes':'scopes/','sensors':'sensors/','tools':'tools/'}[k]
count=0
for p in (root/'contributions').rglob('*.md'):
 text=p.read_text(); target=re.search(r'^target: (.+)$',text,re.M)[1]
 upstream='core/aidlc-common/stages/'+p.parent.name+'/'+target+'.md'
 assert upstream in blobs,upstream
 assert '\nplugin: ui-poc\n' in text
 assert '\n    - ui-poc-comparison\n' in text
 assert 'requires_stage:' not in text and 'required_sections:' not in text
 for anchor in re.findall(r'  - anchor: (.+)',text):
  kind,number=anchor.split(':');assert kind in ('before-step','after-step')
  assert re.search(r'^### Step '+re.escape(number)+r'\b',(source/upstream).read_text(),re.M),anchor
 count+=1
for required in ('rough-mockups','refined-mockups','units-generation','delivery-planning','functional-design','code-generation','build-and-test'):
 assert list((root/'contributions').rglob(required+'.md')),required
sensor=(root/'sensors/aidlc-ui-poc-evidence.md').read_text()
for line in ('id: ui-poc-evidence','default_severity: blocking','fire_on: gate','  output_path: string','  pass: boolean','  findings_count: integer'):
 assert line in sensor
assert (root/'tools/aidlc-sensor-ui-poc-evidence.ts').is_file()
verified=[]
for p in sorted(source.rglob('*')):
 if p.is_file() and p.relative_to(source).as_posix() in blobs:
  b=p.read_bytes(); expected=blobs[p.relative_to(source).as_posix()]
  actual=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
  # Connector/apply_patch materialization may add one final newline. Record precise state.
  match=actual==expected
  if not match and b.endswith(b'\n'):
   short=b[:-1];match=hashlib.sha1(b'blob '+str(len(short)).encode()+b'\0'+short).hexdigest()==expected
  assert match,str(p)+' differs from pinned git blob'
  verified.append({'path':p.relative_to(source).as_posix(),'git_blob_sha':expected,'local_sha256':hashlib.sha256(b).hexdigest(),'trailing_newline_normalization':actual!=expected})
(root/'docs/source-evidence.json').write_text(json.dumps({'upstream_commit':tree['sha'],'verification':'Git blob identity checked; one materialization trailing newline tolerated and recorded','files':verified},indent=2)+'\n')
print(f'PASS: {count} contribution targets and supported anchors checked against pinned source; {len(verified)} source blob identities checked. NOT upstream composer/harness validation.')

assert (root/"tools/ui-poc/contract.md").read_bytes() == (root/"docs/contract.md").read_bytes()
for arm in ("a", "b", "c", "source-lock"):
 assert (root/"tools/ui-poc/treatments"/(arm+".json")).read_bytes() == (root/"treatments"/(arm+".json")).read_bytes()
print("PASS: projected runtime documentation and treatment configs match source copies.")
