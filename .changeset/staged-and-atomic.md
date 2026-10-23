---
"@datocms/release-toolchain": patch
---

Stop at a version that npm staged, and push the branch and the tags atomically.

npm stages a version when the publish needs a 2FA approval. The registry does
not show it, so the next run published it again and npm refused it with "409
Cannot publish over previously staged version". The script now stops before the
push when the publish staged a version, and before the publish when an earlier
run staged one, with the `npm stage approve` command for each one.

`git push` now uses `--atomic`. Without it, origin got the tags also when it
refused the branch. The script also refuses a release tag that is not in the
history of the branch, which happens after `git pull --rebase` of the release
commit, and tells how to move the tag.
