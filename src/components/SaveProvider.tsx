import { useRef, useState, type ReactNode } from "react"
import SaveContext, { useSave } from "./SaveContext"
import { parseSaveFile, type ReadableSaveJson } from "../utils/saveParser"
import type { ArsenalWeaponKey } from "../utils/arsenalWeapons"
import {
  repairWeaponWheelInSaveBytes,
  unlockWeaponsInSaveBytes,
} from "../utils/saveWeaponEditor"

export function OpenSaveButton() {
  const { openSaveFile } = useSave()

  return (
    <div className="app-open-save-group">
      <button
        type="button"
        className="app-open-save"
        onClick={openSaveFile}
      >
        Open save file (.bin)
      </button>
      <span className="app-save-location-hint" tabIndex={0}>
        Where is my save?
        <span className="app-save-location-tooltip" role="tooltip">
          <span className="app-save-location-tooltip-label">
            <i className="fa-brands fa-windows" aria-hidden="true" />
            <i className="fa-brands fa-steam" aria-hidden="true" />
            Windows/Steam:
          </span>
          <code className="app-save-location-tooltip-path">
            C:\Users\(Username)\AppData\LocalLow\The Game Kitchen\Blasphemous
            2\SteamUser_(id)\Savegames\savegame_(0|1|2).bin
          </code>
        </span>
      </span>
    </div>
  )
}

export default function SaveProvider({ children }: { children?: ReactNode }) {
  const [save, setSave] = useState<ReadableSaveJson | null>(null)
  const [saveFileName, setSaveFileName] = useState<string | null>(null)
  const [saveBytes, setSaveBytes] = useState<Uint8Array | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const onFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const parsed = await parseSaveFile(bytes)
      console.log(parsed)
      setSave(parsed)
      setSaveFileName(file.name)
      setSaveBytes(bytes)
    } catch (err) {
      setSave(null)
      setSaveFileName(null)
      setSaveBytes(null)
      console.error(err)
    }
  }

  const exportSaveWithUnlockedWeapons = async (
    weaponKeys: ArsenalWeaponKey[],
  ): Promise<void> => {
    if (!saveBytes) {
      throw new Error("Load a save file first")
    }

    const updatedBytes = unlockWeaponsInSaveBytes(saveBytes, weaponKeys)
    const parsed = await parseSaveFile(updatedBytes)

    const outputName = (saveFileName ?? "savegame.bin").replace(
      /\.bin$/i,
      "-weapons.bin",
    )

    const blob = new Blob([updatedBytes], { type: "application/octet-stream" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = outputName
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)

    setSave(parsed)
    setSaveBytes(updatedBytes)
  }

  const repairWeaponWheel = async (): Promise<void> => {
    if (!saveBytes) {
      throw new Error("Load a save file first")
    }

    const repairedBytes = repairWeaponWheelInSaveBytes(saveBytes)
    const parsed = await parseSaveFile(repairedBytes)

    const outputName = (saveFileName ?? "savegame.bin").replace(
      /\.bin$/i,
      "-repair.bin",
    )

    const blob = new Blob([repairedBytes], { type: "application/octet-stream" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = outputName
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)

    setSave(parsed)
    setSaveBytes(repairedBytes)
  }

  return (
    <SaveContext.Provider
      value={{
        save,
        setSave,
        openSaveFile: () => inputRef.current?.click(),
        saveFileName,
        exportSaveWithUnlockedWeapons,
        repairWeaponWheel,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".bin"
        hidden
        onChange={onFileSelected}
      />
      {children}
    </SaveContext.Provider>
  )
}
