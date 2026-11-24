//go:build windows

package main

import "runtime"

// Win32 window handles and message queues belong to the thread that created
// them. Keep the application's startup goroutine pinned to a single Windows
// OS thread for RegisterClassW, CreateWindowExW and GetMessageW.
func init() {
	runtime.LockOSThread()
}
