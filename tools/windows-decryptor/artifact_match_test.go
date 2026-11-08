package main

import (
    "archive/zip"
    "bytes"
    "strings"
    "testing"
)

func TestArtifactZIPNestedPaths(t *testing.T) {
    for _, name := range []string{
        "sideload.zip.enc",
        "protected-artifacts/sideload.zip.enc",
        "frontend/protected-artifacts/sideload.zip.enc",
        "downloaded-artifacts/Charming.MediaLab-Sideload-Encrypted-253/sideload.zip.enc",
    } {
        t.Run(name, func(t *testing.T) {
            data := makeZIP(t, map[string][]byte{name: []byte("ciphertext")})
            archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
            if err != nil { t.Fatal(err) }
            item, err := archiveItemFlexible(archive, "sideload.zip.enc")
            if err != nil || item == nil || item.Name != name {
                t.Fatalf("expected %q to be found, got %v", name, err)
            }
        })
    }
}

func TestWrongZIPShowsContentsAndInstructions(t *testing.T) {
    data := makeZIP(t, map[string][]byte{
        "README.md": []byte("not the Android artifact"),
        "CharmingMediaLab-APK-Decryptor.exe": []byte("windows program"),
    })
    archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
    if err != nil { t.Fatal(err) }
    _, err = archiveItemFlexible(archive, "sideload.zip.enc")
    if err == nil || !strings.Contains(err.Error(), "Wrong ZIP selected") ||
        !strings.Contains(err.Error(), "Charming.MediaLab-Sideload-Encrypted") ||
        !strings.Contains(err.Error(), "README.md") {
        t.Fatalf("expected helpful wrong-ZIP message, got %v", err)
    }
}

func TestDuplicateEncryptedEntryRejected(t *testing.T) {
    data := makeZIP(t, map[string][]byte{
        "sideload.zip.enc": []byte("a"),
        "subdir/sideload.zip.enc": []byte("b"),
    })
    archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
    if err != nil { t.Fatal(err) }
    _, err = archiveItemFlexible(archive, "sideload.zip.enc")
    if err == nil || !strings.Contains(err.Error(), "more than one") {
        t.Fatalf("expected duplicate rejection, got %v", err)
    }
}
