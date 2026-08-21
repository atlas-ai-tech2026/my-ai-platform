# Throwaway — proving the rotated Anthropic key works

Opened 2026-08-21 to confirm the OpenCodeReview workflow can still authenticate
after `OCR_LLM_AUTH_TOKEN` was rotated and the old `voxel-code-review` key was
deleted.

Rotating a secret and assuming it works is how you find out during something
that matters. This PR is closed and its branch deleted as soon as the run
reports.
