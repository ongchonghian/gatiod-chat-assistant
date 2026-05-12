import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, Box, Typography, Chip,
  IconButton, Collapse, Button, TextField, Tooltip, Divider, Alert,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import type { TraceStep } from "../utils/traceBuilder";

interface DecisionReplayProps {
  open: boolean;
  onClose: () => void;
  steps: TraceStep[];
  onChallenge: (stepId: string, stepTitle: string, concern: string) => void;
}

interface StepCardProps {
  step: TraceStep;
  onChallenge: (stepId: string, stepTitle: string, concern: string) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  step_amputation: "#c4342d",
  step_rom: "#1a3a5c",
  step_dbe: "#d4880f",
  step_neurological: "#7b2d8e",
  step_conflict_resolution: "#2e7d6f",
  step_cvc: "#1565c0",
  step_final: "#1565c0",
};

function StepCard({ step, onChallenge }: StepCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [concern, setConcern] = useState("");

  const color = CATEGORY_COLORS[step.id] ?? "#555";

  function handleSubmitChallenge() {
    if (!concern.trim()) return;
    onChallenge(step.id, step.title, concern.trim());
    setConcern("");
    setChallengeOpen(false);
  }

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
        mb: 1.5,
      }}
    >
      {/* Step header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 2,
          py: 1.25,
          cursor: step.detail.length > 0 ? "pointer" : "default",
          "&:hover": step.detail.length > 0 ? { bgcolor: "action.hover" } : {},
        }}
        onClick={() => step.detail.length > 0 && setDetailOpen((v) => !v)}
      >
        {/* Step number badge */}
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            bgcolor: color,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: "0.75rem",
            fontWeight: 700,
          }}
        >
          {step.number}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: "0.85rem", lineHeight: 1.3 }}>
            {step.title}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontSize: "0.78rem", lineHeight: 1.4, mt: 0.25 }}
          >
            {step.summary}
          </Typography>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}>
          {step.percent !== null && (
            <Chip
              label={`${step.percent}%`}
              size="small"
              sx={{
                fontWeight: 700,
                fontSize: "0.78rem",
                height: 22,
                bgcolor: step.percent > 0 ? color : "action.disabledBackground",
                color: step.percent > 0 ? "#fff" : "text.disabled",
              }}
            />
          )}
          {step.detail.length > 0 && (
            <IconButton size="small" sx={{ ml: -0.5 }} onClick={(e) => { e.stopPropagation(); setDetailOpen((v) => !v); }}>
              {detailOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          )}
        </Box>
      </Box>

      {/* Expanded detail notes */}
      <Collapse in={detailOpen}>
        <Box sx={{ px: 2, pb: 1.5, bgcolor: "grey.50", borderTop: "1px solid", borderColor: "divider" }}>
          {step.detail.map((note, i) => (
            <Typography
              key={i}
              variant="body2"
              color="text.secondary"
              sx={{
                fontSize: "0.8rem",
                lineHeight: 1.7,
                mt: i === 0 ? 1 : 0,
                "&::before": { content: '"›"', mr: 1, color: color, fontWeight: 700 },
              }}
            >
              {note}
            </Typography>
          ))}

          {/* Flag concern row */}
          {step.canChallenge && !challengeOpen && (
            <Box sx={{ mt: 1.5, display: "flex", justifyContent: "flex-end" }}>
              <Button
                size="small"
                startIcon={<ReportProblemOutlinedIcon sx={{ fontSize: "0.9rem !important" }} />}
                onClick={() => setChallengeOpen(true)}
                sx={{
                  fontSize: "0.75rem",
                  color: "warning.dark",
                  borderColor: "warning.main",
                  border: "1px solid",
                  borderRadius: "12px",
                  px: 1.5,
                  py: 0.25,
                  textTransform: "none",
                  "&:hover": { bgcolor: "warning.50", borderColor: "warning.dark" },
                }}
              >
                Flag a concern
              </Button>
            </Box>
          )}
        </Box>
      </Collapse>

      {/* Inline challenge form */}
      <Collapse in={challengeOpen}>
        <Box
          sx={{
            px: 2,
            py: 1.5,
            bgcolor: "warning.50",
            borderTop: "1px solid",
            borderColor: "warning.light",
          }}
        >
          <Typography variant="caption" sx={{ color: "warning.dark", fontWeight: 600, display: "block", mb: 1 }}>
            Describe your concern about "{step.title}"
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={2}
            size="small"
            placeholder="e.g. The shoulder ROM restriction is from scar tissue, not the nerve lesion — R0017 shouldn't apply here"
            value={concern}
            onChange={(e) => setConcern(e.target.value)}
            sx={{
              bgcolor: "#fff",
              "& .MuiOutlinedInput-root": { fontSize: "0.82rem" },
            }}
          />
          <Box sx={{ display: "flex", gap: 1, mt: 1, justifyContent: "flex-end" }}>
            <Button
              size="small"
              onClick={() => { setChallengeOpen(false); setConcern(""); }}
              sx={{ fontSize: "0.75rem", textTransform: "none", color: "text.secondary" }}
            >
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={!concern.trim()}
              onClick={handleSubmitChallenge}
              sx={{
                fontSize: "0.75rem",
                textTransform: "none",
                bgcolor: "warning.main",
                "&:hover": { bgcolor: "warning.dark" },
              }}
            >
              Submit concern
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
}

export default function DecisionReplay({ open, onClose, steps, onChallenge }: DecisionReplayProps) {
  const [challengeSubmitted, setChallengeSubmitted] = useState(false);

  function handleChallenge(stepId: string, stepTitle: string, concern: string) {
    onChallenge(stepId, stepTitle, concern);
    setChallengeSubmitted(true);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3, maxHeight: "85vh" } }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
          <AccountTreeOutlinedIcon sx={{ color: "primary.main", fontSize: 22 }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 700, lineHeight: 1.2 }}>
              How was this calculated?
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Step-by-step decision trace · Flag any step you believe is incorrect
            </Typography>
          </Box>
          <Tooltip title="Close">
            <IconButton size="small" onClick={onClose} sx={{ color: "text.secondary" }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ pt: 2, pb: 2 }}>
        {challengeSubmitted && (
          <Alert
            icon={<CheckCircleOutlineIcon />}
            severity="success"
            sx={{ mb: 2, fontSize: "0.82rem" }}
            onClose={() => setChallengeSubmitted(false)}
          >
            Concern submitted — the assistant will analyse it and either recalculate or register it for expert review.
          </Alert>
        )}

        {steps.map((step) => (
          <StepCard key={step.id} step={step} onChallenge={handleChallenge} />
        ))}

        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ display: "block", textAlign: "center", mt: 1, fontSize: "0.72rem" }}
        >
          CVC combination steps cannot be challenged directly — challenge the category inputs above.
        </Typography>
      </DialogContent>
    </Dialog>
  );
}
