import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import type { ItemRef } from "../utils/catalogs"
import {
  ARSENAL_LAYOUT,
  ARSENAL_WEAPONS,
  getEquippedArsenalWeapons,
  isArsenalWeaponUnlocked,
  type ArsenalWeaponKey,
} from "../utils/arsenalWeapons"
import { useSave } from "./SaveContext"

interface ArsenalOfPenitenceProps {
  weaponSlots?: ItemRef[]
  unlockedWeapons?: ItemRef[]
}

function ArsenalWeaponSlot({
  weaponKey,
  unlocked,
  equipped,
}: {
  weaponKey: ArsenalWeaponKey
  unlocked: boolean
  equipped: boolean
}) {
  const weapon = ARSENAL_WEAPONS[weaponKey]

  return (
    <div
      className={`arsenal-weapon-slot${unlocked ? "" : " arsenal-weapon-slot--locked"}${equipped ? " arsenal-weapon-slot--equipped" : ""}`}
      title={weapon.displayName}
    >
      <div className="arsenal-weapon-icon-slot">
        <span
          className={`wm-sprite wm-sprite--${weapon.sprite}`}
          aria-hidden="true"
        />
      </div>
      <span className="arsenal-weapon-label">{weapon.displayName}</span>
    </div>
  )
}

export default function ArsenalOfPenitence({
  weaponSlots,
  unlockedWeapons,
}: ArsenalOfPenitenceProps) {
  const { exportSaveWithUnlockedWeapons, repairWeaponWheel, saveFileName } = useSave()
  const equipped = getEquippedArsenalWeapons(weaponSlots)
  const allWeaponKeys = useMemo(
    () => Object.keys(ARSENAL_WEAPONS) as ArsenalWeaponKey[],
    [],
  )
  const initializedForFileRef = useRef<string | null>(null)
  const [selectedWeapons, setSelectedWeapons] = useState<ArsenalWeaponKey[]>([])
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    const fileKey = saveFileName ?? "__no-save__"
    if (initializedForFileRef.current === fileKey) return
    initializedForFileRef.current = fileKey

    const defaults = allWeaponKeys.filter((key) =>
      isArsenalWeaponUnlocked(unlockedWeapons, key),
    )
    setSelectedWeapons(defaults)
    setStatus(null)
  }, [allWeaponKeys, saveFileName, unlockedWeapons])

  const toggleWeapon = (key: ArsenalWeaponKey) => {
    setSelectedWeapons((current) => {
      if (current.includes(key)) {
        return current.filter((entry) => entry !== key)
      }
      return [...current, key]
    })
  }

  const unlockAllWeapons = () => {
    setSelectedWeapons(allWeaponKeys)
    setStatus(null)
  }

  const clearSelection = () => {
    setSelectedWeapons([])
    setStatus(null)
  }

  const exportModifiedSave = async () => {
    try {
      await exportSaveWithUnlockedWeapons(selectedWeapons)
      setStatus("Modified save downloaded.")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus(`Could not export save: ${message}`)
    }
  }

  const runRepair = async () => {
    try {
      await repairWeaponWheel()
      setStatus("Recovered save downloaded.")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus(`Could not repair save: ${message}`)
    }
  }

  return (
    <>
      <div className="arsenal-of-penitence">
        {ARSENAL_LAYOUT.map((column, columnIndex) => (
          <div
            key={`arsenal-group-${columnIndex}`}
            className={`arsenal-group${column.length === 1 ? " arsenal-group--single" : ""}`}
          >
            {column.map((weaponKey, weaponIndex) => (
              <Fragment key={weaponKey}>
                {weaponIndex > 0 ? (
                  <hr className="arsenal-group-divider" aria-hidden="true" />
                ) : null}
                <ArsenalWeaponSlot
                  weaponKey={weaponKey}
                  unlocked={isArsenalWeaponUnlocked(unlockedWeapons, weaponKey)}
                  equipped={equipped.has(weaponKey)}
                />
              </Fragment>
            ))}
          </div>
        ))}
      </div>

      <div className="arsenal-editor" role="group" aria-label="Weapon unlock editor">
        <p className="arsenal-editor-title">Unlock weapons in save file</p>

        <div className="arsenal-editor-options">
          {allWeaponKeys.map((key) => {
            const weapon = ARSENAL_WEAPONS[key]
            return (
              <label key={key} className="arsenal-editor-option">
                <input
                  type="checkbox"
                  checked={selectedWeapons.includes(key)}
                  onChange={() => toggleWeapon(key)}
                />
                <span>{weapon.displayName}</span>
              </label>
            )
          })}
        </div>

        <div className="arsenal-editor-actions">
          <button type="button" className="app-open-save" onClick={unlockAllWeapons}>
            Select all
          </button>
          <button type="button" className="app-open-save" onClick={clearSelection}>
            Clear
          </button>
          <button
            type="button"
            className="app-open-save"
            onClick={runRepair}
          >
            Emergency repair .bin
          </button>
          <button
            type="button"
            className="app-open-save app-open-save--accent"
            onClick={exportModifiedSave}
          >
            Export modified .bin
          </button>
        </div>

        <p className="arsenal-editor-note">
          Source: {saveFileName ?? "No save loaded"}
        </p>
        {status ? <p className="arsenal-editor-status">{status}</p> : null}
      </div>
    </>
  )
}
