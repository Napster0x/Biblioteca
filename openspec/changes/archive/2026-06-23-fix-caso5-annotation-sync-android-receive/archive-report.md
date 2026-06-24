# Archive Report

**Change**: `fix-caso5-annotation-sync-android-receive`
**Archived to**: `openspec/changes/archive/2026-06-23-fix-caso5-annotation-sync-android-receive/`
**Date**: 2026-06-23
**Mode**: Hybrid (Engram + filesystem)

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `sync-crdt-hlc-real-device-harness` | Updated | +2 added requirements, 1 modified requirement |

### ADDED Requirements
1. **Desktop Annotation Replica Transport** — Sync execution collects `annotations` rows from desktop `Readest/annotations.db` and PUTs them to Android `/replicas/annotation`.
2. **Caso 5 End-to-End Annotation Receive Pass** — Caso 5 harness passes when Android has ≥1 annotation replica after clean+prepare+fixture+sync.

### MODIFIED Requirements
1. **Distinct Book, Dictionary, Quote, and Annotation Evidence** — Evidence now separates annotation counts from book, dictionary, and quote counts. Missing annotation evidence fails Caso 5.

## Archive Contents

- proposal.md ✅
- specs/sync-crdt-hlc-real-device-harness/spec.md ✅
- design.md ✅
- tasks.md ✅ (9/10 tasks complete; task 4.1 satisfied by real-device harness evidence)
- verify-report.md ✅
- archive-report.md ✅

## Source of Truth Updated

The following specs now reflect the new behavior:
- `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md`

## Verification Summary

- **Verdict**: PASS WITH WARNINGS
- **Tests**: 9/9 sync-execute pass (3 dict + 3 quote + 3 annotation)
- **TDD Compliance**: 6/6 checks passed
- **Spec Compliance**: 6/6 scenarios compliant
- **Harness Evidence**: Real-device Caso 5 PASS (`postAndroid.annotation: 1`)
- **CRITICAL issues**: None

## Engram Observation IDs

| Artifact | ID |
|----------|-----|
| proposal | #1114 |
| spec | #1115 |
| design | #1117 |
| tasks | #1116 |
| apply-progress | #1119 |
| verify-report | #1120 |
| archive-report | #1121 |

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived.
Ready for the next change.
