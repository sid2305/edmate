# Module 4: Writing functions

## 4.1 Why functions?

A **function** is a named piece of code you can run again and again. You have already used built-in functions: `print()`, `len()`, `input()`, `int()`. Now you will write your own.

## 4.2 Defining and calling

```python
def greet(name):
    print(f"Hello, {name}!")

greet("Sam")     # Hello, Sam!
greet("Lee")     # Hello, Lee!
```

- `def`, then the function's name, then brackets with its **parameters**, then a colon.
- The body is indented by 4 spaces.
- Defining a function does not run it. **Calling** it, `greet("Sam")`, runs it. Define a function before the line that calls it.
- A **parameter** is the name in the `def` line (`name`). An **argument** is the value you pass in when you call it (`"Sam"`).

## 4.3 return sends a value back

```python
def square(n):
    return n * n

result = square(4)
print(result)          # 16
print(square(3) + 1)   # 10
```

`return` sends a value back to the place where the function was called, so you can store it or use it in a calculation. `return` also **ends the function straight away**: any lines after it in that function do not run.

## 4.4 print is not return

```python
def add(a, b):
    print(a + b)

result = add(2, 3)   # prints 5
print(result)        # None
```

`add` shows the answer on screen but gives nothing back. A function with no `return` gives back `None`, so `result` is `None`. The fix:

```python
def add(a, b):
    return a + b

result = add(2, 3)
print(result)        # 5
```

**Teacher's rule of thumb:** a function works out a value and returns it; the code that calls it decides whether to print it.

## 4.5 Returning True or False

```python
def is_even(n):
    return n % 2 == 0

print(is_even(4))   # True
print(is_even(7))   # False
```

`n % 2 == 0` is already `True` or `False`, so you can return it directly. A version with `if`/`else` that returns `True` or `False` is also correct, just longer.

## 4.6 Default values

A parameter can have a default, used when no argument is given:

```python
def greet(name="friend"):
    print(f"Hello, {name}!")

greet()          # Hello, friend!
greet("Lee")     # Hello, Lee!
```

## 4.7 Several parameters

```python
def area(width, height):
    return width * height

print(area(3, 4))   # 12
```

Arguments are matched to parameters in order: `width` is 3 and `height` is 4.

## 4.8 Variables inside a function are local

```python
def make_total():
    total = 10

make_total()
print(total)    # NameError: name 'total' is not defined
```

A variable created inside a function is **local**: it exists only while the function runs and cannot be seen outside it. To get a value out, return it and store it:

```python
def make_total():
    total = 10
    return total

total = make_total()
print(total)    # 10
```

## Key points

- `def name(parameters):` then an indented body; call it with `name(arguments)`.
- `return` gives a value back and ends the function; without it you get `None`.
- Printing inside a function is not the same as returning.
- Variables made inside a function stay inside it.
