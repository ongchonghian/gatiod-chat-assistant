import { useState } from "react";
import { Box, Paper, Typography, Collapse, IconButton, Chip, Divider, Button } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import AssessmentIcon from "@mui/icons-material/Assessment";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import DecisionReplay from "./DecisionReplay";
import { buildUpperLimbTrace, type AssessmentResult } from "../utils/traceBuilder";

interface ToolCall {
  name: string;
  result: { success: boolean; data?: Record<string, unknown> };
}

interface GatiodReference {
  chapter: string;
  section?: string;
  table?: string;
}

interface CategoryData {
  label: string;
  rawPercent: number;
  notes: string[];
  gatiodReference?: GatiodReference;
}

interface BreakdownViewProps {
  content: string;
  toolCalls?: ToolCall[];
  onChallenge: (stepId: string, stepTitle: string, concern: string) => void;
}

type SystemKey = "upper_limb" | "lower_limb";

const SYSTEM_LABELS: Record<string, string> = {
  assess_upper_limb: "Upper Limb",
  assess_lower_limb: "Lower Limb",
  assess_spine: "Spine",
  assess_respiratory: "Respiratory",
  assess_renal: "Renal",
  assess_gastro: "Gastro / Digestive",
  assess_hearing: "Hearing",
  assess_cns: "CNS",
  assess_visual: "Visual",
};

const TOOL_TO_SYSTEM: Partial<Record<string, SystemKey>> = {
  assess_upper_limb: "upper_limb",
  assess_lower_limb: "lower_limb",
};

function extractResult(toolCalls?: ToolCall[]): { result: AssessmentResult; systemLabel: string; systemKey?: SystemKey } | null {
  const call = toolCalls?.find(
    (tc) => tc.name.startsWith("assess_") && tc.name !== "assess_global_cvc" && tc.result?.success
  );
  if (!call?.result?.data) return null;
  return {
    result: call.result.data as unknown as AssessmentResult,
    systemLabel: SYSTEM_LABELS[call.name] ?? "System",
    systemKey: TOOL_TO_SYSTEM[call.name],
  };
}

function isCrossStreamWarning(note: string): boolean {
  return note.includes("Cross-stream");
}

function CategorySection({ data, color }: { data: CategoryData; color: string }) {
  const hasWarning = data.notes.some(isCrossStreamWarning);
  const [open, setOpen] = useState(data.rawPercent > 0 || hasWarning);

  if (data.rawPercent === 0 && data.notes.length === 0) return null;

  return (
    <Box>
      <Box
        onClick={() => setOpen(!open)}
        sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer", py: 0.75, "&:hover": { bgcolor: "action.hover" }, borderRadius: 1, px: 1, mx: -1 }}
      >
        <Box sx={{ width: 4, height: 28, borderRadius: 2, bgcolor: color, flexShrink: 0 }} />
        <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 600 }}>{data.label}</Typography>
        {hasWarning && (
          <WarningAmberIcon sx={{ fontSize: 18, color: "warning.main" }} titleAccess="Cross-stream warning" />
        )}
        <Chip label={`${data.rawPercent}%`} size="small" sx={{ fontWeight: 700, bgcolor: data.rawPercent > 0 ? color : "action.disabledBackground", color: data.rawPercent > 0 ? "#fff" : "text.disabled", fontSize: "0.8rem", height: 24, minWidth: 48 }} />
        <IconButton size="small" sx={{ ml: -0.5 }}>
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={open}>
        <Box sx={{ pl: 2.5, pb: 1 }}>
          {data.notes.map((note, i) => {
            const warn = isCrossStreamWarning(note);
            return (
              <Typography
                key={i}
                variant="body2"
                sx={{
                  fontSize: "0.82rem",
                  lineHeight: 1.6,
                  color: warn ? "warning.dark" : "text.secondary",
                  fontWeight: warn ? 600 : 400,
                  "&::before": { content: warn ? '"⚠"' : '"•"', mr: 1, color: warn ? "warning.main" : "text.disabled" },
                }}
              >
                {note}
              </Typography>
            );
          })}
          {data.gatiodReference && (
            <Typography
              variant="caption"
              sx={{
                display: "block",
                mt: 0.5,
                fontSize: "0.72rem",
                color: "text.disabled",
                fontStyle: "italic",
                letterSpacing: "0.02em",
              }}
            >
              {[data.gatiodReference.chapter, data.gatiodReference.section, data.gatiodReference.table]
                .filter(Boolean)
                .join(" · ")}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

export default function BreakdownView({ content, toolCalls, onChallenge }: BreakdownViewProps) {
  const [replayOpen, setReplayOpen] = useState(false);
  const extracted = extractResult(toolCalls);

  if (!extracted) {
    return (
      <Paper sx={{ px: 2.5, py: 1.5, bgcolor: "background.paper", borderRadius: "16px 16px 16px 4px" }}>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{content}</Typography>
      </Paper>
    );
  }

  const { result, systemLabel, systemKey } = extracted;

  const traceSteps = buildUpperLimbTrace(result);

  const categories: { data: CategoryData; color: string }[] = [
    { data: result.amputation, color: "#c4342d" },
    { data: result.rom, color: "#1a3a5c" },
    { data: result.neurological, color: "#7b2d8e" },
    { data: result.dbe, color: "#d4880f" },
  ].filter((cat) => cat.data != null);

  if (systemKey === "lower_limb" && result.shortening) {
    // Insert Shortening between Neurological and DBE to match GATIOD Chapter 4 stream ordering.
    categories.splice(3, 0, { data: result.shortening, color: "#0f7b5c" });
  }

  function handleChallenge(stepId: string, stepTitle: string, concern: string) {
    setReplayOpen(false);
    onChallenge(stepId, stepTitle, concern);
  }

  const headerTitle = systemKey
    ? systemKey === "upper_limb" ? "Upper Limb Permanent Incapacity" : "Lower Limb Permanent Incapacity"
    : `${systemLabel} Permanent Incapacity`;

  return (
    <>
    <Paper sx={{ overflow: "hidden", border: "2px solid", borderColor: "primary.main", borderRadius: 3 }}>
      {/* Header with final PI */}
      <Box sx={{ px: 2.5, py: 2, bgcolor: "primary.main", display: "flex", alignItems: "center", gap: 1.5 }}>
        <AssessmentIcon sx={{ fontSize: 24, color: "#fff" }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" sx={{ color: "rgba(255,255,255,0.7)", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {headerTitle}
          </Typography>
          <Typography variant="h5" sx={{ color: "#fff", fontWeight: 700, letterSpacing: "-0.02em" }}>
            {result.finalPercent}% PI
          </Typography>
        </Box>
      </Box>

      {/* Categories */}
      <Box sx={{ px: 2.5, py: 1.5 }}>
        {categories.map((cat) => (
          <CategorySection key={cat.data.label} data={cat.data} color={cat.color} />
        ))}
      </Box>

      {/* Conflicts */}
      {(result.dbeRomConflicts?.length ?? 0) > 0 && (
        <>
          <Divider />
          <Box sx={{ px: 2.5, py: 1.5 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.68rem" }}>
              Conflict Resolution
            </Typography>
            {result.dbeRomConflicts.map((c, i) => (
              <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
                <Typography variant="body2" sx={{ fontSize: "0.82rem" }}>
                  {c.joint}: ROM {c.romPercent}% vs DBE {c.dbePercent}%
                </Typography>
                <Chip label={`${c.winner} retained`} size="small" sx={{ fontSize: "0.7rem", height: 20, fontWeight: 600, bgcolor: "warning.main", color: "#fff" }} />
              </Box>
            ))}
          </Box>
        </>
      )}

      {/* CVC Sequence */}
      {(result.cvcInputs?.length ?? 0) > 1 && (
        <>
          <Divider />
          <Box sx={{ px: 2.5, py: 1.5 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.68rem" }}>
              CVC Combination
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.5, flexWrap: "wrap" }}>
              {result.cvcInputs.map((v, i) => (
                <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <Chip label={`${v}%`} size="small" variant="outlined" sx={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, fontSize: "0.8rem" }} />
                  {i < result.cvcInputs.length - 1 && (
                    <Typography variant="body2" color="text.disabled" sx={{ fontSize: "0.75rem" }}>+</Typography>
                  )}
                </Box>
              ))}
              <Typography variant="body2" color="text.disabled" sx={{ fontSize: "0.75rem", mx: 0.5 }}>=</Typography>
              <Chip label={`${result.finalPercent}%`} size="small" sx={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: "0.85rem", bgcolor: "primary.main", color: "#fff" }} />
            </Box>
          </Box>
        </>
      )}

      {/* Decision Replay trigger */}
      <Divider />
      <Box sx={{ px: 2.5, py: 1.25, display: "flex", justifyContent: "flex-end" }}>
        <Button
          size="small"
          startIcon={<AccountTreeOutlinedIcon sx={{ fontSize: "0.9rem !important" }} />}
          onClick={() => setReplayOpen(true)}
          sx={{
            fontSize: "0.75rem",
            textTransform: "none",
            color: "text.secondary",
            fontWeight: 500,
            "&:hover": { color: "primary.main" },
          }}
        >
          How was this calculated?
        </Button>
      </Box>
    </Paper>

    <DecisionReplay
      open={replayOpen}
      onClose={() => setReplayOpen(false)}
      steps={traceSteps}
      onChallenge={handleChallenge}
    />
    </>
  );
}
