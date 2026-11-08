package main

import (
    "archive/zip"
    "fmt"
    "path"
    "strings"
)

// archiveItemFlexible accepts the encrypted files in the root of the GitHub
// Actions ZIP or under an enclosing directory (some ZIP tools add one).
// It never extracts paths from the outer ZIP, and rejects ambiguous duplicates.
func archiveItemFlexible(reader *zip.Reader, filename string) (*zip.File, error) {
    var match *zip.File
    for _, file := range reader.File {
        if file.FileInfo().IsDir() {
            continue
        }
        normalized := strings.ReplaceAll(file.Name, "\\", "/")
        if path.Base(normalized) != filename {
            continue
        }
        if match != nil {
            return nil, fmt.Errorf("artifact contains more than one %s; select the original GitHub Actions artifact ZIP", filename)
        }
        match = file
    }
    if match != nil {
        return match, nil
    }
    entries := make([]string, 0, 7)
    for _, file := range reader.File {
        if !file.FileInfo().IsDir() {
            entries = append(entries, fmt.Sprintf("%q", file.Name))
            if len(entries) == 7 {
                break
            }
        }
    }
    if len(entries) == 0 {
        entries = append(entries, "(empty ZIP)")
    }
    return nil, fmt.Errorf(
        "Wrong ZIP selected: missing %s.\n\nFiles actually found: %s\n\nGo to GitHub Actions > a successful Charming MediaLab Android build > Artifacts. Download Charming.MediaLab-Sideload-Encrypted-[number].zip. Do not select the Windows Decryptor ZIP or Source code ZIP.",
        filename, strings.Join(entries, ", "),
    )
}
