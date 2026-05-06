import { useState } from "react";
import { Box, Paper, Typography, Collapse, IconButton, Chip, Divider } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import AssessmentIcon from "@mui/icons-material/Assessment";

interface ToolCall {
  name: string;
  result: { success: boolean; data?: Record<string, unknown> };
}

interface CategoryData {
  label: string;
  rawPercent: number;
  notes: string[];
}

interface Conflict {
  joint: string;
  romPercent: number;
  dbePercent: number;
  winner: string;
}

interface AssessmentResult {
  finalPercent: number;
  amputation: CategoryData;
  rom: CategoryData;
  neurological: CategoryData;
  dbe: CategoryData;
  dbeRomConflicts: Conflict[];
  cvcInputs: number[];
}

interface BreakdownViewProps {
  content: string;
  toolCalls?: ToolCall[];
}

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

function extractResult(toolCalls?: ToolCall[]): { result: AssessmentResult; systemLabel: string } | null {
  const call = toolCalls?.find(
    (tc) => tc.name.startsWith("assess_") && tc.name !== "assess_global_cvc" && tc.result?.success
  );
  if (!call?.result?.data) return null;
  return {
    result: call.result.data as unknown as AssessmentResult,
    systemLabel: SYSTEM_LABELS[call.name] ?? "System",
  };
}

function CategorySection({ data, color }: { data: CategoryData; color: string }) {
  const [open, setOpen] = useState(data.rawPercent > 0);

  if (data.rawPercent === 0 && data.notes.length === 0) return null;

  return (
    <Box>
      <Box
        onClick={() => setOpen(!open)}
        sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer", py: 0.75, "&:hover": { bgcolor: "action.hover" }, borderRadius: 1, px: 1, mx: -1 }}
      >
        <Box sx={{ width: 4, height: 28, borderRadius: 2, bgcolor: color, flexShrink: 0 }} />
        <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 600 }}>{data.label}</Typography>
        <Chip label={`${data.rawPercent}%`} size="small" sx={{ fontWeight: 700, bgcolor: data.rawPercent > 0 ? color : "action.disabledBackground", color: data.rawPercent > 0 ? "#fff" : "text.disabled", fontSize: "0.8rem", height: 24, minWidth: 48 }} />
        <IconButton size="small" sx={{ ml: -0.5 }}>
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={open}>
        <Box sx={{ pl: 2.5, pb: 1 }}>
          {data.notes.map((note, i) => (
            <Typography key={i} variant="body2" color="text.secondary" sx={{ fontSize: "0.82rem", lineHeight: 1.6, "&::before": { content: '"•"', mr: 1, color: "text.disabled" } }}>
              {note}
            </Typography>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

export default function BreakdownView({ content, toolCalls }: BreakdownViewProps) {
  const extracted = extractResult(toolCalls);

  if (!extracted) {
    return (
      <Paper sx={{ px: 2.5, py: 1.5, bgcolor: "background.paper", borderRadius: "16px 16px 16px 4px" }}>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{content}</Typography>
      </Paper>
    );
  }

  const { result, systemLabel } = extracted;

  const categories: { data: CategoryData; color: string }[] = [
    { data: result.amputation, color: "#c4342d" },
    { data: result.rom, color: "#1a3a5c" },
    { data: result.neurological, color: "#7b2d8e" },
    { data: result.dbe, color: "#d4880f" },
  ].filter((cat) => cat.data != null);

  return (
    <Paper sx={{ overflow: "hidden", border: "2px solid", borderColor: "primary.main", borderRadius: 3 }}>
      {/* Header with final PI */}
      <Box sx={{ px: 2.5, py: 2, bgcolor: "primary.main", display: "flex", alignItems: "center", gap: 1.5 }}>
        <AssessmentIcon sx={{ fontSize: 24, color: "#fff" }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" sx={{ color: "rgba(255,255,255,0.7)", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {systemLabel} Permanent Incapacity
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
    </Paper>
  );
}
