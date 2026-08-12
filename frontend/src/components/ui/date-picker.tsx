import { useState } from "react"
import { format, parseISO, isValid } from "date-fns"
import { Calendar as CalendarIcon, X } from "@/lib/icons"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface DatePickerProps {
  value: string | null
  onChange: (value: string | null) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

// Stores/returns ISO yyyy-MM-dd (the shape the API already uses for start_date,
// target_date, etc.). Renders a popover calendar + clear button.
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
  disabled,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)

  const parsed = value ? parseISO(value) : null
  const selected = parsed && isValid(parsed) ? parsed : undefined

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-8 text-sm font-normal justify-start text-left flex-1",
              !value && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {value ? format(parseISO(value), "MMM d, yyyy") : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(day) => {
              onChange(day ? format(day, "yyyy-MM-dd") : null)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => onChange(null)}
          aria-label="Clear date"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
