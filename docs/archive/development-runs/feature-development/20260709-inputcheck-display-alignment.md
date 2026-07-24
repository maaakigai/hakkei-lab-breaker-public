# 20260709 InputCheck display alignment

## Target

InputCheck release screen display alignment.

## Changed files

- `src/main/index.ts`
- `src/renderer/styles.css`
- `docs/runs/20260709-inputcheck-display-alignment.md`

## Decisions

- Release main window now starts as fullscreen and hides the default Electron menu bar.
- Settings and registered-users windows keep normal window behavior.
- InputCheck proceed block is a flex column with centered children.

## Reasoning

- `MILESTONES.md` records the screen skeleton as fullscreen，and the presentation UI is intended to occupy the full display.
- The reported screenshot showed the default Electron menu bar and Windows taskbar，so the content was centered inside a reduced client area rather than the presentation surface.
- The proceed CTA and phone-ready text are one visual block，so centering the parent flex axis avoids child inline layout differences causing a visible offset.

## Verification

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd run lint` passed.

## Manual check

1. Run `scripts/windows/release.bat`.
2. On the InputCheck screen，confirm the Electron menu bar is not visible and the Windows taskbar is hidden.
3. Confirm the status ring，`KEYBOARD MODE` or `CONNECTED` title，`PROCEED` button，and phone-ready text share the same horizontal center.
4. Run `scripts/windows/debug.bat` and confirm the debug window still opens as a normal window for development checks.

## Remaining issues

- No real display screenshot could be captured from the unavailable in-app browser in this session.
