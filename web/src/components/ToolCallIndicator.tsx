import { useState } from "react";
import { Box, Typography, Collapse, Chip } from "@mui/material";
import BuildCircleIcon from "@mui/icons-material/BuildCircle";

interface ToolCall {
  name: string;
  result: { success: boolean; data?: Record<string, unknown> };
}

const TOOL_LABELS: Record<string, string> = {
  assess_upper_limb: "Full Assessment",
  lookup_rom_table: "ROM Lookup",
  lookup_amputation_level: "Amputation Lookup",
  lookup_nerve: "Nerve Lookup",
  lookup_dbe_condition: "DBE Lookup",
  search_dictionary: "Dictionary Search",
};

export default function ToolCallIndicator({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [open, setOpen] = useState(false);

  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <Box>
      <Box
        onClick={() => setOpen(!open)}
        sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, cursor: "pointer", opacity: 0.6, "&:hover": { opacity: 1 }, transition: "opacity 0.15s" }}
      >
        <BuildCircleIcon sx={{ fontSize: 14, color: "text.secondary" }} />
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.7rem" }}>
          {toolCalls.length} tool{toolCalls.length > 1 ? "s" : ""} used
        </Typography>
      </Box>
      <Collapse in={open}>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
          {toolCalls.map((tc, i) => (
            <Chip
              key={i}
              size="small"
              label={TOOL_LABELS[tc.name] ?? tc.name}
              sx={{
                fontSize: "0.68rem",
                height: 20,
                bgcolor: tc.result?.success ? "rgba(46,125,111,0.1)" : "rgba(196,52,45,0.1)",
                color: tc.result?.success ? "secondary.dark" : "error.main",
                fontWeight: 500,
              }}
            />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
