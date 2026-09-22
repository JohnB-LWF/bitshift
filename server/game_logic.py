import secrets


def generate_ip(previous=None):
    while True:
        ip = [secrets.randbelow(256) for _ in range(4)]
        if ip != previous:
            return ip


def validate(ip, answers):
    if not isinstance(answers, list) or len(answers) != 4:
        return [False] * 4
    return [isinstance(a, str) and a == format(n, '08b') for n, a in zip(ip, answers)]
