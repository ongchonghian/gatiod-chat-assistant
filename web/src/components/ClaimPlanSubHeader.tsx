import { useState } from "react";
import { Box, Button, Chip, Menu, MenuItem, Tooltip, Typography } from "@mui/material";

// Types mirror src/v2/contracts.ts ClaimPlanView. The frontend tsconfig
// scopes to web/src/ so we redeclare them here. Slice #02 surface only;
// slice #03 extends to multi-pill + bilateral badge; slice #07 wires Submit.
type SystemKey =
  | "upper_limb" | "lower_limb" | "spine" | "respiratory" | "renal"
  | "gastro_digestive" | "hearing" | "cns" | "visual";

type PillStatus =
  | "idle" | "collecting" | "needs_confirmation" | "calculated"
  | "skipped_by_user";

export interface SystemPillView {
  system: SystemKey;
  label: string;
  status: PillStatus;
  subtotalPercent: number | null;
  sideBreakdown?: { left?: number; right?: number };
  isLegacyMode: boolean;
}

export interface ClaimPlanView {
  systems: SystemPillView[];
  submitState: { visible: boolean; blockingSystems?: SystemKey[] };
  nextSystem?: SystemKey;
  isSubmitted: boolean;
  submittedAt?: string;
}

interface Props {
  view: ClaimPlanView | null;
  /** ADR-0006 — invoked when the doctor clicks the Submit chip. */
  onSubmitClaim?: () => void;
  /** ADR-0006 §7 — invoked when the doctor clicks Reopen on a submitted claim. */
  onReopenClaim?: () => void;
  /**
   * Slice #04 — invoked when the doctor picks an action from a pill's peek menu.
   * `action` is one of "edit" (jump-to system) / "skip" / "reconfirm".
   * The parent translates each into the appropriate API call.
   */
  onPillAction?: (system: SystemKey, action: "edit" | "skip" | "reconfirm") => void;
  /**
   * Slice #06 — invoked when the doctor selects a system from the "+ add"
   * overflow menu. The parent POSTs a request that writes a
   * `claimComponentOverrides[X] = "detected"` entry.
   */
  onAddSystem?: (system: SystemKey) => void;
}

const ALL_SYSTEMS: SystemKey[] = [
  "upper_limb", "lower_limb", "spine", "respiratory", "renal",
  "gastro_digestive", "hearing", "cns", "visual",
];

const SYSTEM_DISPLAY: Record<SystemKey, string> = {
  upper_limb: "Upper Limb",
  lower_limb: "Lower Limb",
  spine: "Spine",
  respiratory: "Respiratory",
  renal: "Renal",
  gastro_digestive: "Gastro-Digestive",
  hearing: "Hearing",
  cns: "CNS",
  visual: "Visual",
};

const STATUS_COLOR: Record<PillStatus, "default" | "primary" | "warning" | "success" | "secondary"> = {
  idle: "default",
  collecting: "warning",
  needs_confirmation: "warning",
  calculated: "success",
  skipped_by_user: "secondary",
};

function formatSubtotal(p: SystemPillView): string {
  if (p.subtotalPercent === null) return "";
  return ` ${p.subtotalPercent}%`;
}

function isBilateral(p: SystemPillView): boolean {
  if (!p.sideBreakdown) return false;
  return p.sideBreakdown.left !== undefined && p.sideBreakdown.right !== undefined;
}

/**
 * Persistent sub-header below AppBar that anchors progress visibility
 * across the multi-system claim. Hidden when no system has been detected
 * yet. Driven by `claim-plan-projection` on the server; this component is
 * a dumb consumer of the projected view.
 *
 * Slice #02 surface: empty (hidden) and single-pill rendering only.
 * Subsequent slices (#03 multi-pill, #04 click-to-jump, #05 legacy class,
 * #06 add overflow, #07 Submit chip) extend this component.
 */
export default function ClaimPlanSubHeader({ view, onSubmitClaim, onReopenClaim, onPillAction, onAddSystem }: Props) {
  // Slice #04 — pill peek state. Tracks which pill (if any) has its menu open
  // and where the menu should be anchored.
  const [peek, setPeek] = useState<{ anchor: HTMLElement; system: SystemKey; status: PillStatus } | null>(null);
  // Slice #06 — "+ add system" menu anchor.
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);

  if (!view) return null;
  if (view.systems.length === 0 && !view.isSubmitted) return null;

  const submitDisabled = !view.submitState.visible;
  const blockingLabels = (view.submitState.blockingSystems ?? [])
    .map((s) => SYSTEM_DISPLAY[s])
    .join(", ");
  const submitTooltip = view.isSubmitted
    ? `Submitted at ${view.submittedAt ?? ""}`
    : view.submitState.visible
      ? "Submit this claim"
      : blockingLabels
        ? `Waiting on: ${blockingLabels}`
        : "Describe an injury to get started";

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 2,
        py: 0.75,
        borderBottom: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        overflowX: "auto",
      }}
    >
      <Typography variant="caption" sx={{ color: "text.secondary", mr: 0.5, whiteSpace: "nowrap" }}>
        Claim plan:
      </Typography>
      {view.systems.map((pill) => {
        const chipNode = (
          <Chip
            onClick={onPillAction ? (e) => setPeek({ anchor: e.currentTarget as HTMLElement, system: pill.system, status: pill.status }) : undefined}
            label={
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                <span>{pill.label}{formatSubtotal(pill)}</span>
                {isBilateral(pill) && (
                  <Box
                    component="span"
                    sx={{
                      fontSize: "0.65rem",
                      fontWeight: 600,
                      px: 0.5,
                      py: 0.1,
                      borderRadius: 0.5,
                      bgcolor: "rgba(0,0,0,0.08)",
                      lineHeight: 1.2,
                    }}
                    aria-label="bilateral assessment"
                  >
                    L+R
                  </Box>
                )}
              </Box>
            }
            size="small"
            color={STATUS_COLOR[pill.status]}
            variant={pill.status === "calculated" ? "filled" : "outlined"}
            sx={{
              fontWeight: 500,
              ...(pill.isLegacyMode ? { borderStyle: "dashed" } : {}),
            }}
          />
        );
        // Slice #05 — transitional visual class for CNS/Visual while still on
        // legacy migration mode. The dashed border ships from slice #02; this
        // adds a hover tooltip explaining the visual difference.
        return pill.isLegacyMode ? (
          <Tooltip
            key={pill.system}
            title={`${pill.label} is being assessed in legacy mode. Migration to the structured pipeline is in progress.`}
            arrow
          >
            <Box component="span">{chipNode}</Box>
          </Tooltip>
        ) : (
          <Box key={pill.system} component="span">
            {chipNode}
          </Box>
        );
      })}
      <Menu
        open={Boolean(peek)}
        anchorEl={peek?.anchor ?? null}
        onClose={() => setPeek(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <MenuItem
          onClick={() => {
            if (peek && onPillAction) onPillAction(peek.system, "edit");
            setPeek(null);
          }}
        >
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (peek && onPillAction) onPillAction(peek.system, "skip");
            setPeek(null);
          }}
        >
          Skip this system
        </MenuItem>
        <MenuItem
          disabled={peek?.status !== "calculated"}
          onClick={() => {
            if (peek && onPillAction) onPillAction(peek.system, "reconfirm");
            setPeek(null);
          }}
        >
          Re-confirm
        </MenuItem>
      </Menu>
      {/* Slice #06 — "+ add system" overflow */}
      {!view.isSubmitted && view.systems.length > 0 && (() => {
        const present = new Set(view.systems.map((p) => p.system));
        const available = ALL_SYSTEMS.filter((s) => !present.has(s));
        if (available.length === 0) return null;
        return (
          <>
            <Tooltip title="Add another system to this claim" arrow>
              <Chip
                label="+ add"
                size="small"
                variant="outlined"
                onClick={(e) => setAddMenuAnchor(e.currentTarget as HTMLElement)}
                sx={{ fontWeight: 500, ml: 0.5 }}
              />
            </Tooltip>
            <Menu
              open={Boolean(addMenuAnchor)}
              anchorEl={addMenuAnchor}
              onClose={() => setAddMenuAnchor(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
            >
              {available.map((sys) => (
                <MenuItem
                  key={sys}
                  onClick={() => {
                    if (onAddSystem) onAddSystem(sys);
                    setAddMenuAnchor(null);
                  }}
                >
                  {SYSTEM_DISPLAY[sys]}
                </MenuItem>
              ))}
            </Menu>
          </>
        );
      })()}
      <Box sx={{ flex: 1 }} />
      {view.isSubmitted ? (
        <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
          <Chip
            label={`Submitted${view.submittedAt ? ` ${new Date(view.submittedAt).toLocaleTimeString()}` : ""}`}
            size="small"
            color="success"
            variant="filled"
            sx={{ fontWeight: 500 }}
          />
          <Button
            size="small"
            variant="outlined"
            color="secondary"
            onClick={onReopenClaim}
            sx={{ textTransform: "none", py: 0.25, px: 1.25, fontWeight: 500 }}
          >
            Reopen this claim
          </Button>
        </Box>
      ) : (
        <Tooltip title={submitTooltip} arrow>
          <span>
            <Button
              size="small"
              variant="contained"
              color="primary"
              disabled={submitDisabled}
              onClick={onSubmitClaim}
              sx={{ textTransform: "none", py: 0.25, px: 1.5, fontWeight: 600 }}
            >
              Submit claim
            </Button>
          </span>
        </Tooltip>
      )}
    </Box>
  );
}
