# Module 3: Repeating with for and while

## 3.1 for loops

A `for` loop runs its indented body once for each item in a sequence. A string is a sequence of characters:

```python
for letter in "cat":
    print(letter)
```

This prints `c`, `a` and `t`, each on its own line. Like `if`, the `for` line ends with a colon and the body is indented.

## 3.2 range()

`range()` gives a sequence of whole numbers, which is the usual way to repeat something a set number of times.

| Code | Numbers produced |
| --- | --- |
| `range(5)` | 0, 1, 2, 3, 4 (five numbers, starting at 0) |
| `range(1, 5)` | 1, 2, 3, 4 |
| `range(0, 10, 3)` | 0, 3, 6, 9 (the third number is the step) |
| `range(5, 0, -1)` | 5, 4, 3, 2, 1 |

The stop number is **never included**. `range(1, 5)` stops at 4. To include 10, write `range(1, 11)`.

```python
for i in range(3):
    print("Hi")      # prints Hi three times
```

## 3.3 The accumulator pattern

To add things up, keep a running total in a variable:

```python
total = 0                 # 1. start at 0, BEFORE the loop
for n in range(1, 6):     # 2. go through 1, 2, 3, 4, 5
    total += n            # 3. add each number
print(total)              # 4. AFTER the loop: 15
```

- If you put `total = 0` inside the loop, the total is reset on every pass.
- If you put `print(total)` inside the loop (indented), you see every running total, not just the final one.

Counting works the same way. How many even numbers are there from 1 to 10?

```python
evens = 0
for n in range(1, 11):
    if n % 2 == 0:
        evens += 1
print(evens)   # 5
```

## 3.4 while loops

A `while` loop repeats as long as its condition is True:

```python
count = 3
while count > 0:
    print(count)
    count -= 1
print("Lift off!")
```

This prints `3`, `2`, `1` and then `Lift off!`.

Something in the body must change the condition, or the loop never ends. This is an **infinite loop**:

```python
count = 0
while count < 5:
    print(count)      # prints 0 forever: count never changes
```

The fix is to add `count += 1` inside the loop. If a program is stuck in a loop, press **Ctrl+C** to stop it.

A `while` loop is the right tool when you do not know in advance how many times to repeat, for example "keep asking until the user types quit":

```python
while True:
    command = input("Type a command (or quit): ")
    if command == "quit":
        break
    print(f"You typed {command}")
print("Bye")
```

## 3.5 break and continue

- `break` leaves the loop straight away.
- `continue` skips the rest of this pass and goes on to the next one.

```python
for n in range(1, 8):
    if n == 3:
        continue      # skip 3
    if n == 6:
        break         # stop completely at 6
    print(n)
```

This prints `1`, `2`, `4` and `5`.

## 3.6 for or while?

- Use `for` when you know what to go through: the characters of a string, the numbers in a `range()`, or (in Module 5) the items in a list.
- Use `while` when you repeat until something happens: the user types quit, a countdown reaches 0.

## Key points

- `range(start, stop)` stops **before** `stop`.
- For a running total, start at 0 before the loop and print after it.
- A `while` loop needs something inside it that changes the condition.
- `break` stops the loop; `continue` skips to the next pass.
