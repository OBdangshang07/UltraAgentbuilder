---
name: voxel-studio
description: Generate or revise bounded Minecraft BuildingSpec and experimental SceneSpec designs, and inspect Voxel Studio Bridge jobs, exports, and projection drafts. Use for the Fabric Voxel Studio companion, not arbitrary HTML extraction or server administration.
---

# Voxel Studio

Locate the companion directory containing `bridge/server.mjs`, `contracts/building-spec.schema.mjs`, and `prompts/building-v1.md`. It may be the repository root or the `voxel-studio` directory beside a Minecraft instance's `mods` folder. Do not assume paths under the original author's profile.

Read the versioned prompt and schema before authoring a spec. Compile data with `src/generation/compiler.mjs`; export with `src/generation/export.mjs`. Do not execute generated JavaScript or write another NBT exporter. Approved materials are in `src/generation/materials.mjs`; unknown materials must fail.

For the experimental design workflow, first read `prompts/scene-v1.md` and `contracts/scene-spec.schema.mjs` under the companion directory. `src/design/compiler.mjs` lowers SceneSpec into BuildingSpec and the same native cells used by projection and placement. Choose `generationMode: "scene"` explicitly; keep existing generation choices available. Let the building description determine the architecture, not the offline study fixtures. Check actual occupied dimensions and rendered geometry: a feature named in the brief, an empty shaft or a successful compile is not evidence of design quality or working circulation.

Scene native bundles retain `scene.json`, `design-sources.json` and `source-owners.bin` with hashes. For local refinement, use `src/design/revision.mjs` with the saved compiled asset as `baseCompiled`, not a newly recompiled substitute baseline. Bind caller-selected component/instance scope and the original asset hash; shared-module edits require all consumers to be explicitly selected. Do not enlarge dependency scope silently. Compiler diagnostics distinguish blocked data, navigation review and advisory design checks; a `diagnosticOnly` asset is never importable, exportable or placeable, even with navigation acknowledgement. Preserve original model outputs and record local engineering branches separately from first-attempt model success.

The loopback Bridge starts with `node bridge/server.mjs --data-dir <directory>`. A packaged Windows companion includes `runtime/node.exe`. Read `data/connection.json` for port and bearer token; never print or share the token. Only contact the exact 127.0.0.1 endpoint. Job requests to `/v1/jobs` require a unique stable `key`; repeating the same request reuses its job. Poll state; a manifest is usable only at `preview-ready`. Account discovery is read-only; AI generation uses the selected account/model and must be in the user's request scope.

Default to no automatic model repair/retry. Reserve and record every authorized attempt, including failed or unknown outcomes; do not resend an uncertain job. Output token settings inherit the selected provider unless the user supplies a budget. Geometry/expansion safety limits are separate from token limits. Image-based refinement requires an explicitly advertised image capability and confirmation; text feedback is not evidence the model saw the rendered asset.

Keep/clear/set masks, spec hashes, revision and placement transforms are authoritative. Absence of a block is not permission to excavate. Preserve prior completed jobs when revising or cancelling. Schematic air cannot represent both keep and clear; retain the binary cells manifest for native placement.

Projection, visibility, opacity and movement are client-only. Never treat preview approval as unrestricted world-write authority. Actual writes require the locked, checked draft, current dimension and explicit in-game confirmation. First-release direct placement is limited to the single-player creative host. Crash-ambiguous journal batches require review; do not guess or overwrite later player edits.

When sharing, provide the complete mod/companion release, not a Skill alone. Exclude runtime `data`, account files, pairing tokens, private generations and worlds. Report alpha limitations and actual test evidence instead of claiming the complete roadmap is finished.
