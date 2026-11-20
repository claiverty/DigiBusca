import { Check, ChevronDown } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import './AppSelect.css'

export type AppSelectOption = {
  value: string
  label: string
  disabled?: boolean
}

type AppSelectProps = {
  id?: string
  value: string
  options: readonly AppSelectOption[]
  onValueChange: (value: string) => void
  ariaLabel: string
  disabled?: boolean
  placeholder?: string
  size?: 'default' | 'compact'
  className?: string
}

function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
}

export function AppSelect({
  id,
  value,
  options,
  onValueChange,
  ariaLabel,
  disabled = false,
  placeholder = 'Selecione uma opção',
  size = 'default',
  className = '',
}: AppSelectProps) {
  const generatedId = useId()
  const triggerId = id ?? `app-select-${generatedId}`
  const listboxId = `${triggerId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const typeaheadRef = useRef('')
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>()

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined
  const enabledIndices = useMemo(
    () => options.flatMap((option, index) => option.disabled ? [] : [index]),
    [options],
  )
  const activeOptionId = open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined

  function findEnabledIndex(start: number, direction: 1 | -1) {
    for (let index = start; index >= 0 && index < options.length; index += direction) {
      if (!options[index].disabled) return index
    }
    return -1
  }

  function openMenu(index = selectedIndex >= 0 && !options[selectedIndex].disabled
    ? selectedIndex
    : (enabledIndices[0] ?? -1)) {
    setActiveIndex(index)
    setMenuStyle(undefined)
    setOpen(true)
  }

  function closeMenu(restoreFocus = false) {
    setOpen(false)
    setActiveIndex(-1)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function chooseOption(option: AppSelectOption) {
    if (option.disabled) return
    onValueChange(option.value)
    closeMenu(true)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Tab') {
      if (open) closeMenu()
      return
    }

    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        closeMenu(true)
      }
      return
    }

    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      openMenu()
      return
    }

    if (!open) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const start = activeIndex >= 0 ? activeIndex + direction : selectedIndex + direction
      const nextIndex = findEnabledIndex(start, direction)
      if (nextIndex >= 0) setActiveIndex(nextIndex)
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const nextIndex = event.key === 'Home'
        ? (enabledIndices[0] ?? -1)
        : (enabledIndices.at(-1) ?? -1)
      setActiveIndex(nextIndex)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = options[activeIndex]
      if (option) chooseOption(option)
      return
    }

    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      typeaheadRef.current += normalizeSearch(event.key)
      if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current)
      typeaheadTimerRef.current = setTimeout(() => { typeaheadRef.current = '' }, 700)
      const start = activeIndex >= 0 ? activeIndex + 1 : selectedIndex + 1
      const ordered = [...options.slice(start), ...options.slice(0, Math.max(0, start))]
      const match = ordered.find((option) => !option.disabled && normalizeSearch(option.label).startsWith(typeaheadRef.current))
      if (match) setActiveIndex(options.indexOf(match))
    }
  }

  useLayoutEffect(() => {
    if (!open) return

    const updateMenuPosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const horizontalGutter = 12
      const width = Math.min(rect.width, Math.max(0, window.innerWidth - horizontalGutter * 2))
      const left = Math.max(horizontalGutter, Math.min(rect.left, window.innerWidth - width - horizontalGutter))
      const desiredHeight = Math.min(320, Math.max(80, enabledIndices.length * 44 + 12))
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - horizontalGutter)
      const spaceAbove = Math.max(0, rect.top - horizontalGutter)
      const openAbove = spaceBelow < Math.min(desiredHeight, 220) && spaceAbove > spaceBelow
      const availableHeight = openAbove ? spaceAbove : spaceBelow
      const maxHeight = Math.max(96, Math.min(desiredHeight, availableHeight))

      setMenuStyle({
        position: 'fixed',
        left,
        width,
        maxHeight,
        ...(openAbove
          ? { top: rect.top - 7, transform: 'translateY(-100%)' }
          : { top: rect.bottom + 7 }),
      })
    }

    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [enabledIndices.length, open])

  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return
    listboxRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  useLayoutEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || listboxRef.current?.contains(target)) return
      closeMenu()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
  }, [open])

  useLayoutEffect(() => () => {
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current)
  }, [])

  const classNames = ['app-select', `app-select--${size}`, className].filter(Boolean).join(' ')

  return (
    <div className={classNames} ref={rootRef}>
      <button
        id={triggerId}
        ref={triggerRef}
        className="app-select-trigger"
        type="button"
        role="combobox"
        aria-label={`${ariaLabel}: ${selectedOption?.label ?? placeholder}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        disabled={disabled}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={handleKeyDown}
      >
        <span className="app-select-value">{selectedOption?.label ?? placeholder}</span>
        <ChevronDown className="app-select-chevron" size={17} aria-hidden="true" />
      </button>
      {open && menuStyle && createPortal(
        <div
          id={listboxId}
          ref={listboxRef}
          className="app-select-menu"
          role="listbox"
          aria-label={ariaLabel}
          style={menuStyle}
        >
          {options.map((option, index) => {
            const selected = option.value === value
            const highlighted = index === activeIndex
            return (
              <div
                id={`${listboxId}-option-${index}`}
                key={`${triggerId}-${option.value}`}
                className="app-select-option"
                role="option"
                aria-selected={selected}
                aria-disabled={option.disabled || undefined}
                data-option-index={index}
                data-highlighted={highlighted || undefined}
                onPointerMove={() => { if (!option.disabled) setActiveIndex(index) }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseOption(option)}
              >
                <span>{option.label}</span>
                {selected && <Check size={15} aria-hidden="true" />}
              </div>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
